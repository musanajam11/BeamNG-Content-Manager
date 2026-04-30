/**
 * Helpers for the `beammp-cm://` invite URL scheme.
 *
 * The custom scheme is registered with the OS in the main process (see
 * src/main/index.ts). When a user shares the link, clicking it on a system
 * with CM installed opens CM with the embedded server info; clicking it
 * without CM installed falls back to the public landing page that ships
 * an install button.
 *
 * Schema (keep in sync with parseInviteUrl in src/main/index.ts):
 *   beammp-cm://join?ip=<host>&port=<1-65535>
 *                  [&name=<sname>][&map=<map>][&password=<pw>][&from=<sender>]
 */

/** Public landing page that handles users without CM installed. */
export const INVITE_FALLBACK_URL = 'https://bmr.musanet.xyz/content-manager'

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
