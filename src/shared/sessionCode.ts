/**
 * Shared session-code codec used by both the main process and the renderer for
 * the World Edit coop editor flow.
 *
 * A session code is a single opaque string that encodes every piece of data a
 * joiner needs to hit the host's relay:
 *
 *   - `v`  — protocol version (currently 2)
 *   - `h`  — host address (hostname / IPv4 / Tailscale MagicDNS)
 *   - `p`  — relay TCP port
 *   - `t`  — optional shared-secret token (null/omitted for open sessions)
 *   - `l`  — optional level name the host is working on
 *   - `s`  — optional short session id (first 8 chars) for display only
 *   - `n`  — optional host display name for the UI preview before connect
 *
 * Wire format: `BEAMCM2:<base64url(JSON)>`. Legacy v1 codes `BEAMCM:<base64>`
 * are still accepted for backwards compatibility.
 */

export const SESSION_CODE_PROTOCOL = 2
export const SESSION_CODE_PREFIX = 'BEAMCM2:'
export const LEGACY_SESSION_CODE_PREFIX = 'BEAMCM:'

/** Fully decoded session code payload. */
export interface SessionCodePayload {
  host: string
  port: number
  token: string | null
  level: string | null
  sessionId: string | null
  displayName: string | null
}

/** What the caller supplies to `encodeSessionCode`. */
export interface SessionCodeInput {
  host: string
  port: number
  token?: string | null
  level?: string | null
  sessionId?: string | null
  displayName?: string | null
}

/* ── base64url helpers (work in both Node and browser) ───────────────────── */

function b64encodeUtf8(s: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64')
  // Browser fallback
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
function b64decodeUtf8(s: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf8')
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}
function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function fromBase64Url(b64url: string): string {
  const s = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return s + pad
}

/* ── Encode / decode ─────────────────────────────────────────────────────── */

export function encodeSessionCode(input: SessionCodeInput): string {
  const body: Record<string, unknown> = {
    v: SESSION_CODE_PROTOCOL,
    h: input.host,
    p: input.port,
  }
  if (input.token) body.t = input.token
  if (input.level) body.l = input.level
  if (input.sessionId) body.s = input.sessionId.slice(0, 8)
  if (input.displayName) body.n = input.displayName
  const json = JSON.stringify(body)
  return SESSION_CODE_PREFIX + toBase64Url(b64encodeUtf8(json))
}

/**
 * Parse either a v2 `BEAMCM2:` code or a legacy v1 `BEAMCM:` invite.
 * Returns null on malformed input.
 */
export function decodeSessionCode(code: string): SessionCodePayload | null {
  try {
    let raw = code.trim()
    let legacy = false
    if (raw.toUpperCase().startsWith(SESSION_CODE_PREFIX.toUpperCase())) {
      raw = raw.slice(SESSION_CODE_PREFIX.length)
    } else if (raw.toUpperCase().startsWith(LEGACY_SESSION_CODE_PREFIX.toUpperCase())) {
      raw = raw.slice(LEGACY_SESSION_CODE_PREFIX.length)
      legacy = true
    } else {
      return null
    }
    const json = b64decodeUtf8(fromBase64Url(raw))
    const obj = JSON.parse(json) as Record<string, unknown>
    const host = typeof obj.h === 'string' ? obj.h : null
    const port = typeof obj.p === 'number' ? obj.p : null
    if (!host || !port || port < 1 || port > 65535) return null
    const token = typeof obj.t === 'string' && obj.t ? obj.t : null
    const level = !legacy && typeof obj.l === 'string' && obj.l ? obj.l : null
    const sessionId = !legacy && typeof obj.s === 'string' && obj.s ? obj.s : null
    const displayName = !legacy && typeof obj.n === 'string' && obj.n ? obj.n : null
    return { host, port, token, level, sessionId, displayName }
  } catch {
    return null
  }
}

/** Quick predicate for UI. Accepts both v1 and v2. */
export function isSessionCode(s: string): boolean {
  const u = s.trim().toUpperCase()
  return u.startsWith(SESSION_CODE_PREFIX.toUpperCase())
      || u.startsWith(LEGACY_SESSION_CODE_PREFIX.toUpperCase())
}
