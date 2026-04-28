// ─────────────────────────────────────────────────────────────────────────
// BeamNG Mod Registry (bmr.musanet.xyz) HTTP client.
//
// Owns the persistent session cookie + CSRF token and exposes typed methods
// the renderer reaches over IPC. The renderer is sandboxed by CSP from
// hitting bmr directly; everything funnels through here so the cookie jar
// stays in the main process.
//
// Cookies are persisted to userData so the user stays signed in across app
// restarts. CSRF is double-submit: the server sets a non-httpOnly cookie
// `bmr_csrf`, we mirror it into `x-csrf-token` on every mutating request.
// ─────────────────────────────────────────────────────────────────────────

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  BmrAuthState,
  BmrCallResult,
  BmrPublicConfig,
  BmrRating,
  BmrSearchOptions,
  BmrSearchResult,
  BmrUser,
} from '../../shared/bmr-types'

const DEFAULT_BASE_URL = 'https://bmr.musanet.xyz'
const CSRF_COOKIE = 'bmr_csrf'
const CSRF_HEADER = 'x-csrf-token'
const COOKIE_FILE = 'bmr-cookies.json'

interface StoredCookie {
  name: string
  value: string
  /** ms-since-epoch expiry, or null for session-scoped. */
  expires: number | null
}

interface PersistedCookies {
  base: string
  cookies: StoredCookie[]
}

export class BmrService {
  private baseUrl: string
  private cookieJar: Map<string, StoredCookie> = new Map()
  private cookiesPath: string
  private csrfToken: string | null = null
  private cachedUser: BmrUser | null = null
  private inflightCsrf: Promise<void> | null = null

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    const dir = join(app.getPath('appData'), 'BeamMP-ContentManager')
    this.cookiesPath = join(dir, COOKIE_FILE)
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  async load(): Promise<void> {
    try {
      if (existsSync(this.cookiesPath)) {
        const raw = await readFile(this.cookiesPath, 'utf-8')
        const parsed = JSON.parse(raw) as PersistedCookies
        if (parsed.base === this.baseUrl) {
          const now = Date.now()
          for (const c of parsed.cookies) {
            if (c.expires && c.expires < now) continue
            this.cookieJar.set(c.name, c)
            if (c.name === CSRF_COOKIE) this.csrfToken = c.value
          }
        }
      }
    } catch (err) {
      console.warn('[Bmr] Failed to load cookie jar:', err)
    }
    // Best-effort warm-up: ensure we have a CSRF cookie so the first POST
    // doesn't have to round-trip twice. Failure is silent — we'll lazy
    // re-fetch on demand.
    if (!this.csrfToken) {
      void this.ensureCsrf().catch(() => {
        /* offline at boot is fine, just retry on first call */
      })
    }
    // Refresh cached user (cookie may have been invalidated server-side).
    await this.refreshMe().catch(() => {
      /* not signed in or offline — fine */
    })
  }

  private async persist(): Promise<void> {
    try {
      const dir = join(this.cookiesPath, '..')
      if (!existsSync(dir)) await mkdir(dir, { recursive: true })
      const payload: PersistedCookies = {
        base: this.baseUrl,
        cookies: Array.from(this.cookieJar.values()),
      }
      await writeFile(this.cookiesPath, JSON.stringify(payload), 'utf-8')
    } catch (err) {
      console.warn('[Bmr] Failed to persist cookie jar:', err)
    }
  }

  private async clearCookies(): Promise<void> {
    this.cookieJar.clear()
    this.csrfToken = null
    this.cachedUser = null
    try {
      if (existsSync(this.cookiesPath)) await unlink(this.cookiesPath)
    } catch {
      /* ignore */
    }
  }

  getAuthState(): BmrAuthState {
    return { signedIn: this.cachedUser !== null, user: this.cachedUser }
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  // ── Cookie + CSRF plumbing ───────────────────────────────────────────

  private cookieHeader(): string {
    const now = Date.now()
    const parts: string[] = []
    for (const [, c] of this.cookieJar) {
      if (c.expires && c.expires < now) continue
      parts.push(`${c.name}=${c.value}`)
    }
    return parts.join('; ')
  }

  private absorbSetCookie(headers: Headers): void {
    // `Headers.getSetCookie()` is the modern, multi-value-aware accessor;
    // fall back to `get('set-cookie')` (single combined string) for older
    // runtimes. Each value parsed individually for name/value/expires.
    const list: string[] = []
    const anyHeaders = headers as unknown as { getSetCookie?: () => string[] }
    if (typeof anyHeaders.getSetCookie === 'function') {
      list.push(...anyHeaders.getSetCookie())
    } else {
      const raw = headers.get('set-cookie')
      if (raw) list.push(raw)
    }
    if (list.length === 0) return
    let dirty = false
    for (const cookieStr of list) {
      const segments = cookieStr.split(';').map((s) => s.trim())
      const first = segments.shift()
      if (!first) continue
      const eq = first.indexOf('=')
      if (eq <= 0) continue
      const name = first.slice(0, eq)
      const value = first.slice(eq + 1)
      let expires: number | null = null
      for (const seg of segments) {
        const lower = seg.toLowerCase()
        if (lower.startsWith('max-age=')) {
          const secs = Number(seg.slice(8))
          if (Number.isFinite(secs)) expires = Date.now() + secs * 1000
        } else if (lower.startsWith('expires=')) {
          const t = Date.parse(seg.slice(8))
          if (!Number.isNaN(t)) expires = t
        }
      }
      // Treat empty value with past expiry as deletion.
      if (value === '' && expires !== null && expires < Date.now()) {
        if (this.cookieJar.delete(name)) dirty = true
        if (name === CSRF_COOKIE) this.csrfToken = null
        continue
      }
      this.cookieJar.set(name, { name, value, expires })
      if (name === CSRF_COOKIE) this.csrfToken = value
      dirty = true
    }
    if (dirty) void this.persist()
  }

  private async ensureCsrf(): Promise<void> {
    if (this.csrfToken) return
    if (this.inflightCsrf) return this.inflightCsrf
    this.inflightCsrf = (async () => {
      try {
        await this.request('GET', '/api/auth/csrf')
      } finally {
        this.inflightCsrf = null
      }
    })()
    return this.inflightCsrf
  }

  // ── Core fetch wrapper ───────────────────────────────────────────────

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    opts: { skipCsrf?: boolean } = {}
  ): Promise<BmrCallResult<T>> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
    const isMutation = method !== 'GET' && method !== 'HEAD'
    if (isMutation && !opts.skipCsrf) await this.ensureCsrf()
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'BeamMP-ContentManager',
    }
    const cookies = this.cookieHeader()
    if (cookies) headers['Cookie'] = cookies
    if (isMutation && this.csrfToken) headers[CSRF_HEADER] = this.csrfToken
    let payload: BodyInit | undefined
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    let res: Response
    try {
      res = await fetch(url, { method, headers, body: payload, redirect: 'manual' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, status: 0, error: `network_error: ${msg}` }
    }
    this.absorbSetCookie(res.headers)
    let data: unknown = undefined
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      try {
        data = await res.json()
      } catch {
        /* malformed json — leave undefined */
      }
    } else {
      try {
        data = await res.text()
      } catch {
        /* ignore */
      }
    }
    if (!res.ok) {
      const fromBody =
        data && typeof data === 'object' ? (data as { error?: string }).error : undefined
      const errCode: string = typeof fromBody === 'string' && fromBody ? fromBody : `http_${res.status}`
      return { ok: false, status: res.status, error: errCode, details: data }
    }
    return { ok: true, status: res.status, data: data as T }
  }

  // ── Auth ─────────────────────────────────────────────────────────────

  async getPublicConfig(): Promise<BmrCallResult<BmrPublicConfig>> {
    return this.request<BmrPublicConfig>('GET', '/api/auth/config')
  }

  async refreshMe(): Promise<BmrCallResult<{ user: BmrUser | null }>> {
    const res = await this.request<{ user: BmrUser | null }>('GET', '/api/auth/me')
    if (res.ok) this.cachedUser = res.data?.user ?? null
    return res
  }

  /**
   * Ingest cookies obtained from an external Electron session (e.g. after the
   * user signed in via the desktop browser window). Persists the jar and
   * refreshes the cached user.
   */
  async ingestCookies(
    cookies: Array<{ name: string; value: string; expires?: number | null }>,
  ): Promise<BmrCallResult<{ user: BmrUser | null }>> {
    for (const c of cookies) {
      const expires =
        c.expires == null
          ? null
          : c.expires < 1e12 // electron returns seconds
            ? Math.round(c.expires * 1000)
            : c.expires
      this.cookieJar.set(c.name, { name: c.name, value: c.value, expires })
      if (c.name === CSRF_COOKIE) this.csrfToken = c.value
    }
    await this.persist()
    return this.refreshMe()
  }

  async signup(input: {
    email: string
    password: string
    display_name: string
    turnstile_token?: string
  }): Promise<BmrCallResult<{ user: BmrUser }>> {
    const res = await this.request<{ user: BmrUser }>('POST', '/api/auth/signup', input)
    if (res.ok && res.data) this.cachedUser = res.data.user
    return res
  }

  async login(input: {
    email: string
    password: string
    turnstile_token?: string
  }): Promise<BmrCallResult<{ user: BmrUser }>> {
    const res = await this.request<{ user: BmrUser }>('POST', '/api/auth/login', input)
    if (res.ok && res.data) this.cachedUser = res.data.user
    return res
  }

  async logout(): Promise<BmrCallResult<{ ok: boolean }>> {
    const res = await this.request<{ ok: boolean }>('POST', '/api/auth/logout')
    // Server clears cookies; wipe locally either way so we don't keep a
    // stale session even if the server failed.
    await this.clearCookies()
    // Re-seed CSRF for the next anonymous POST (login again).
    await this.ensureCsrf().catch(() => {})
    return res
  }

  async resendVerification(): Promise<BmrCallResult> {
    return this.request('POST', '/api/auth/resend-verification')
  }

  // ── Public read ──────────────────────────────────────────────────────

  async searchMods(opts: BmrSearchOptions = {}): Promise<BmrCallResult<BmrSearchResult>> {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(opts)) {
      if (v === undefined || v === null || v === '') continue
      qs.set(k, String(v))
    }
    const path = qs.toString() ? `/api/mods?${qs}` : '/api/mods'
    return this.request<BmrSearchResult>('GET', path)
  }

  async getMod(identifier: string): Promise<BmrCallResult<unknown>> {
    return this.request('GET', `/api/mods/${encodeURIComponent(identifier)}`)
  }

  async getModHistory(identifier: string): Promise<BmrCallResult<unknown>> {
    return this.request('GET', `/api/mods/${encodeURIComponent(identifier)}/history`)
  }

  // ── Ratings ──────────────────────────────────────────────────────────

  async setRating(identifier: string, stars: number): Promise<BmrCallResult<{ rating: BmrRating }>> {
    return this.request<{ rating: BmrRating }>(
      'PUT',
      `/api/mods/${encodeURIComponent(identifier)}/rating`,
      { stars }
    )
  }

  async clearRating(identifier: string): Promise<BmrCallResult<{ rating: BmrRating }>> {
    return this.request<{ rating: BmrRating }>(
      'DELETE',
      `/api/mods/${encodeURIComponent(identifier)}/rating`
    )
  }
}
