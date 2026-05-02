/**
 * Helpers for the `beammp-cm://` invite URL scheme.
 *
 * The custom scheme is registered with the OS in the main process (see
 * src/main/index.ts). When a user shares the link, clicking it on a system
 * with CM installed opens CM with the embedded server info; clicking it
 * without CM installed they land on the BMR join page which offers a
 * CM download link.
 *
 * Schema (keep in sync with parseInviteUrl in src/main/index.ts):
 *   beammp-cm://join?ip=<host>&port=<1-65535>
 *                  [&name=<sname>][&map=<map>][&password=<pw>][&from=<sender>]
 */

/** Public landing page / CM download page. */
export const INVITE_FALLBACK_URL = 'https://bmr.musanet.xyz/content-manager'
/** Base URL for short invite links served by bmr.musanet.xyz. */
const BMR_INVITE_API = 'https://bmr.musanet.xyz/api/invite'

export interface InviteLinkParams {
  ip: string
  port: number | string
  /** Optional friendly name encoded for display in the confirmation card. */
  name?: string
  /** Optional map slug from the server. */
  map?: string
  /** Optional pre-shared password for private servers. */
  password?: string
  /** Optional inviter handle. */
  from?: string
}

/**
 * Build a `beammp-cm://join?...` URL. Empty / undefined optional fields are
 * omitted so the resulting link stays short and shareable.
 */
export function buildInviteLink(params: InviteLinkParams): string {
  const url = new URL('beammp-cm://join')
  url.searchParams.set('ip', String(params.ip))
  url.searchParams.set('port', String(params.port))
  if (params.name) url.searchParams.set('name', params.name)
  if (params.map) url.searchParams.set('map', params.map)
  if (params.password) url.searchParams.set('password', params.password)
  if (params.from) url.searchParams.set('from', params.from)
  return url.toString()
}

/**
 * Build a web fallback URL that opens the install/landing page and forwards
 * the same join parameters. The landing page is responsible for then
 * triggering `beammp-cm://...` if CM is installed.
 */
export function buildInviteFallbackLink(params: InviteLinkParams): string {
  const url = new URL(INVITE_FALLBACK_URL)
  url.searchParams.set('ip', String(params.ip))
  url.searchParams.set('port', String(params.port))
  if (params.name) url.searchParams.set('name', params.name)
  if (params.map) url.searchParams.set('map', params.map)
  if (params.password) url.searchParams.set('password', params.password)
  if (params.from) url.searchParams.set('from', params.from)
  return url.toString()
}

/**
 * Create a short invite link via the BMR backend.
 *
 * Returns a short `https://bmr.musanet.xyz/j/<code>` URL on success.
 * Falls back to a plain `beammp-cm://` deep link if the API call fails
 * (e.g. offline / unreachable), so copy always produces something usable.
 */
export async function createShortInviteLink(params: Pick<InviteLinkParams, 'ip' | 'port'>): Promise<string> {
  // Prefer main-process IPC (no renderer CORS restrictions).
  try {
    if (window.api?.createShortInviteLink) {
      const viaMain = await window.api.createShortInviteLink(String(params.ip), Number(params.port))
      if (viaMain) return viaMain
    }
  } catch {
    // Fall through to renderer-side fetch fallback.
  }

  try {
    const res = await fetch(BMR_INVITE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: String(params.ip), port: Number(params.port) }),
    })
    if (res.ok) {
      const data = await res.json() as { url?: string }
      if (data.url) return data.url
    }
  } catch {
    // Network offline or server unreachable — fall through to deep link.
  }
  return buildInviteLink(params)
}
