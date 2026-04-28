// ── BeamNG Mod Registry (bmr.musanet.xyz) integration types ──
// These mirror the Fastify backend at web/backend/src/routes/public.ts and
// auth/routes.ts. Only the fields we actually consume are typed.

export interface BmrUser {
  id: number
  email: string
  display_name: string
  role: 'admin' | 'user'
  trust: 'green' | 'yellow' | 'red'
  github_username: string | null
  email_verified: boolean
  avatar_url: string | null
  created_at: number
}

export interface BmrPublicConfig {
  turnstile_site_key: string | null
  email_verification_required: boolean
}

export interface BmrRating {
  avg: number
  count: number
  /** 0 if the viewer has not rated; 1–5 otherwise. */
  mine: number
}

export interface BmrLastEdit {
  identifier: string
  user_id: number
  display_name: string
  avatar_url: string | null
  kind: string
  version: string | null
  decided_at: number | null
}

export interface BmrOwner {
  user_id: number
  display_name: string
  avatar_url: string | null
  claimed_at: number | null
}

/**
 * One mod row from `GET /api/mods`. The backend returns the full
 * `summarize(modEntry)` payload plus joined `last_edit`, `owner`, `rating`.
 * We type the fields the desktop client touches; everything else stays
 * `unknown`-shaped so the renderer can pass it through opaquely.
 */
export interface BmrModListItem {
  identifier: string
  name: string
  abstract: string
  author: string | null
  license: string | null
  kind: string
  mod_type: string | null
  version: string
  download: string | null
  thumbnail: string | null
  tags: string[]
  multiplayer_scope: 'client' | 'server' | 'both' | null
  verified: boolean
  release_status: string | null
  resources?: Record<string, string | undefined>
  versions?: Array<{ version: string; release_date?: string | null }>
  last_edit: BmrLastEdit | null
  owner: BmrOwner | null
  rating: BmrRating
}

export interface BmrFacets {
  mod_types: Record<string, number>
  kinds: Record<string, number>
  licenses: Record<string, number>
  statuses: Record<string, number>
  multiplayer: Record<string, number>
  verified: { true: number; false: number }
  /** Pre-sorted, top-N (200) by count then alpha. */
  tags: Array<{ value: string; count: number }>
  /** Pre-sorted, top-N (100) by count then alpha. */
  authors: Array<{ value: string; count: number }>
}

export interface BmrSearchResult {
  items: BmrModListItem[]
  total: number
  page: number
  pageSize: number
  facets: BmrFacets
}

/**
 * Search query forwarded to the registry. Each field maps directly to a
 * Zod-validated query parameter on the backend (see public.ts QuerySchema).
 */
export interface BmrSearchOptions {
  q?: string
  type?: string
  tag?: string
  /** Comma-joined tag list. */
  tags?: string
  tag_mode?: 'all' | 'any'
  author?: string
  license?: string
  kind?: string
  status?: string
  multiplayer?: string
  verified?: 'true' | 'false'
  /** Comma-joined: download,thumbnail,repository,homepage,bugtracker,beamng_resource,depends,provides */
  has?: string
  min_rating?: number
  sort?: 'name' | '-name' | 'identifier' | '-identifier' | 'rating' | '-rating' | 'recent'
  page?: number
  pageSize?: number
}

/** Result envelope returned over IPC for any auth/mutation call. */
export interface BmrCallResult<T = unknown> {
  ok: boolean
  status: number
  data?: T
  error?: string
  /** Body returned by the server on error, useful for surfacing field issues. */
  details?: unknown
}

/** Snapshot of the current bmr session held by the main process. */
export interface BmrAuthState {
  signedIn: boolean
  user: BmrUser | null
}
