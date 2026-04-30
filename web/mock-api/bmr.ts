// BMR (BeamNG Mod Registry) mock — talks to the real bmr.musanet.xyz HTTP
// API for browse / sign-in when CORS allows; otherwise falls back to a
// local demo session.

import type { BmrAuthState, BmrCallResult, BmrPublicConfig, BmrUser } from '../../src/shared/bmr-types'

// In dev (Vite) we use the local reverse proxy to bypass CORS. In production
// (GitHub Pages) we route through a public CORS proxy so the demo can still
// hit the real BMR backend without CORS headers configured on the origin.
const BMR_ORIGIN = 'https://bmr.musanet.xyz'
const BMR_PUBLIC_BASE = BMR_ORIGIN
function bmrUrl(path: string): string {
  if (import.meta.env.DEV) return `/__proxy/bmr${path}`
  return `https://corsproxy.io/?url=${encodeURIComponent(`${BMR_ORIGIN}${path}`)}`
}
const SESSION_KEY = 'bmp-cm-demo:bmr-session'

interface StoredSession {
  user: BmrUser
  signedInAt: number
}

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function saveSession(s: StoredSession | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else localStorage.removeItem(SESSION_KEY)
  } catch { /* quota */ }
}

function authStateFromSession(s: StoredSession | null): BmrAuthState {
  return s ? { signedIn: true, user: s.user } : { signedIn: false, user: null }
}

async function tryFetch<T>(path: string, init?: RequestInit): Promise<BmrCallResult<T>> {
  try {
    const r = await fetch(bmrUrl(path), {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
    })
    const text = await r.text()
    let data: unknown
    try { data = text ? JSON.parse(text) : undefined } catch { data = text }
    if (!r.ok) {
      return { ok: false, status: r.status, error: extractError(data) || `HTTP ${r.status}`, details: data }
    }
    return { ok: true, status: r.status, data: data as T }
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message || 'network' }
  }
}

function extractError(data: unknown): string | undefined {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (typeof d.error === 'string') return d.error
    if (typeof d.message === 'string') return d.message
  }
  return undefined
}

const DEMO_USER: BmrUser = {
  id: 999,
  email: 'demo@example.com',
  display_name: 'Demo User',
  role: 'user',
  trust: 'green',
  github_username: null,
  email_verified: true,
  avatar_url: null,
  created_at: Date.now() - 86_400_000 * 365
}

export const bmrMocks = {
  bmrGetBaseUrl: async (): Promise<string> => BMR_PUBLIC_BASE,

  bmrGetAuthState: async (): Promise<BmrAuthState> => authStateFromSession(loadSession()),

  bmrGetPublicConfig: async (): Promise<BmrCallResult<BmrPublicConfig>> => {
    const r = await tryFetch<BmrPublicConfig>('/api/public/config')
    if (r.ok) return r
    // Fallback so UI renders even if CORS blocks us.
    return {
      ok: true,
      status: 200,
      data: { turnstile_site_key: null, email_verification_required: false }
    }
  },

  bmrRefreshMe: async (): Promise<{ result: BmrCallResult<BmrUser>; state: BmrAuthState }> => {
    const r = await tryFetch<{ user: BmrUser }>('/api/auth/me')
    if (r.ok && r.data?.user) {
      const session: StoredSession = { user: r.data.user, signedInAt: Date.now() }
      saveSession(session)
      return {
        result: { ok: true, status: r.status, data: r.data.user },
        state: { signedIn: true, user: r.data.user }
      }
    }
    return {
      result: { ok: false, status: r.status, error: r.error },
      state: authStateFromSession(loadSession())
    }
  },

  bmrLogin: async (input: { email: string; password: string; turnstile_token?: string }): Promise<{
    result: BmrCallResult<BmrUser>
    state: BmrAuthState
  }> => {
    const r = await tryFetch<{ user: BmrUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input)
    })
    if (r.ok && r.data?.user) {
      saveSession({ user: r.data.user, signedInAt: Date.now() })
      return {
        result: { ok: true, status: r.status, data: r.data.user },
        state: { signedIn: true, user: r.data.user }
      }
    }
    // CORS/network fallback: accept any non-empty creds as a demo sign-in.
    if (r.status === 0 && input.email && input.password) {
      const user: BmrUser = { ...DEMO_USER, email: input.email, display_name: input.email.split('@')[0] || 'Demo User' }
      saveSession({ user, signedInAt: Date.now() })
      return {
        result: { ok: true, status: 200, data: user },
        state: { signedIn: true, user }
      }
    }
    return {
      result: { ok: false, status: r.status, error: r.error || 'login_failed', details: r.details },
      state: authStateFromSession(loadSession())
    }
  },

  bmrSignup: async (input: { email: string; password: string; display_name: string; turnstile_token?: string }): Promise<{
    result: BmrCallResult<BmrUser>
    state: BmrAuthState
  }> => {
    const r = await tryFetch<{ user: BmrUser }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(input)
    })
    if (r.ok && r.data?.user) {
      saveSession({ user: r.data.user, signedInAt: Date.now() })
      return {
        result: { ok: true, status: r.status, data: r.data.user },
        state: { signedIn: true, user: r.data.user }
      }
    }
    if (r.status === 0 && input.email && input.password) {
      const user: BmrUser = { ...DEMO_USER, email: input.email, display_name: input.display_name || 'Demo User' }
      saveSession({ user, signedInAt: Date.now() })
      return {
        result: { ok: true, status: 200, data: user },
        state: { signedIn: true, user }
      }
    }
    return {
      result: { ok: false, status: r.status, error: r.error || 'signup_failed', details: r.details },
      state: authStateFromSession(loadSession())
    }
  },

  bmrLogout: async (): Promise<{ result: BmrCallResult<null>; state: BmrAuthState }> => {
    await tryFetch<null>('/api/auth/logout', { method: 'POST' })
    saveSession(null)
    return {
      result: { ok: true, status: 200, data: null },
      state: { signedIn: false, user: null }
    }
  },

  bmrResendVerification: async (): Promise<BmrCallResult<null>> => {
    const r = await tryFetch<null>('/api/auth/resend-verification', { method: 'POST' })
    return r.ok ? r : { ok: false, status: r.status, error: r.error || 'failed' }
  },

  bmrDesktopSignIn: async (): Promise<BmrCallResult<null>> => ({
    ok: false,
    status: 0,
    error: 'Desktop sign-in flow is only available in the installed app.'
  }),

  // Search & detail proxy through to the real public API when CORS allows.
  bmrSearchMods: async (opts: Record<string, unknown>): Promise<BmrCallResult<unknown>> => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(opts)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
    }
    return tryFetch(`/api/mods?${params.toString()}`)
  },
  bmrGetMod: async (identifier: string): Promise<BmrCallResult<unknown>> =>
    tryFetch(`/api/mods/${encodeURIComponent(identifier)}`),
  bmrGetModHistory: async (identifier: string): Promise<BmrCallResult<unknown>> =>
    tryFetch(`/api/mods/${encodeURIComponent(identifier)}/history`),

  bmrSetRating: async (identifier: string, rating: number): Promise<BmrCallResult<unknown>> =>
    tryFetch(`/api/mods/${encodeURIComponent(identifier)}/rating`, {
      method: 'PUT',
      body: JSON.stringify({ rating })
    }),
  bmrClearRating: async (identifier: string): Promise<BmrCallResult<unknown>> =>
    tryFetch(`/api/mods/${encodeURIComponent(identifier)}/rating`, { method: 'DELETE' })
}
