// ── BeamNG Mod Registry Types ──
// Mirrors the .beammod metadata spec for the CKAN-style mod registry.

/** Relationship descriptor: a dependency, recommendation, suggestion, or conflict */
export interface RegistryRelationship {
  /** Mod identifier (e.g. "drift_tires_pack") */
  identifier: string
  /** Minimum version (inclusive), optional */
  min_version?: string
  /** Maximum version (inclusive), optional */
  max_version?: string
  /** Exact version, optional (overrides min/max) */
  version?: string
}

/** An "any of" relationship — at least one must be satisfied */
export interface RegistryAnyOfRelationship {
  any_of: RegistryRelationship[]
  /** Help text for when the user must choose between alternatives */
  choice_help_text?: string
}

export type RegistryRelationshipDescriptor = RegistryRelationship | RegistryAnyOfRelationship

/** Install directive: tells the client where to put files from the archive */
export interface InstallDirective {
  /** Exact path within the archive to install (mutual exclusive with find/find_regexp) */
  file?: string
  /** Directory name to locate in the archive */
  find?: string
  /** Regex to locate in the archive */
  find_regexp?: string
  /** Target location: "mods", "mods/repo", or a subfolder relative to userDir */
  install_to: string
  /** Rename the matched directory/file during install */
  as?: string
  /** Filenames or directories to exclude */
  filter?: string | string[]
  /** Regex patterns to exclude */
  filter_regexp?: string | string[]
  /** Whitelist: only install files matching these names (inverse of filter) */
  include_only?: string | string[]
  /** Whitelist: only install files matching these regex patterns */
  include_only_regexp?: string | string[]
  /** When true, find/find_regexp can match individual files, not just directories */
  find_matches_files?: boolean
}

/** External resource links */
export interface ModResources {
  homepage?: string
  repository?: string
  bugtracker?: string
  /** beamng.com resource page URL */
  beamng_resource?: string
  /** BeamMP forum thread */
  beammp_forum?: string
}

/**
 * The .beammod metadata file — describes a single version of a mod.
 * Adapted from CKAN's spec for the BeamNG/BeamMP ecosystem.
 */
export interface BeamModMetadata {
  /** Spec version for forward compatibility. Currently 1. */
  spec_version: number

  /** Globally unique identifier (ASCII letters, digits, hyphens, underscores). */
  identifier: string

  /** Human-readable mod name. */
  name: string

  /** One-line description. */
  abstract: string

  /** Mod author or list of authors. */
  author: string | string[]

  /** Mod version string, e.g. "1.2.3" or "2:1.0" (epoch:version). */
  version: string

  /** License (SPDX-style). */
  license: string | string[]

  /**
   * Mod kind:
   * - "package" (default) — a normal downloadable mod
   * - "metapackage" — no download, just dependencies (modpack)
   * - "dlc" — official DLC, detected but not installable
   */
  kind?: 'package' | 'metapackage' | 'dlc'

  /** Full URL(s) to the mod archive (.zip). Not required for metapackage/dlc. */
  download?: string | string[]

  /** SHA256 hash of the download archive. */
  download_hash?: { sha256: string }

  /** Download size in bytes. */
  download_size?: number

  /** Installed size in bytes. */
  install_size?: number

  /** Mod type: vehicle, map, skin, ui_app, sound, license_plate, scenario, automation, other */
  mod_type?: string

  /** Tags for categorization. */
  tags?: string[]

  /** Long-form description (Markdown). */
  description?: string

  /** Release status. */
  release_status?: 'stable' | 'testing' | 'development'

  /** ISO date of this release. */
  release_date?: string

  /** Exact BeamNG.drive version this targets. "any" or "0.32" etc. */
  beamng_version?: string
  /** Minimum BeamNG.drive version (inclusive). */
  beamng_version_min?: string
  /** Maximum BeamNG.drive version (inclusive). */
  beamng_version_max?: string

  /** Minimum BeamMP version required (for multiplayer mods). */
  beammp_version_min?: string

  /** Install directives. If omitted, installs to mods/ by default. */
  install?: InstallDirective[]

  /** Hard dependencies — must be installed. */
  depends?: RegistryRelationshipDescriptor[]
  /** Recommended mods — installed by default, user can decline. */
  recommends?: RegistryRelationshipDescriptor[]
  /** Suggested mods — not installed by default, user can opt-in. */
  suggests?: RegistryRelationshipDescriptor[]
  /** Mods this enhances when present (reverse-suggests). Informational only. */
  supports?: RegistryRelationshipDescriptor[]
  /** Mods this conflicts with — cannot coexist. */
  conflicts?: RegistryRelationshipDescriptor[]
  /** Virtual packages this mod satisfies (e.g. "wheel_physics_framework"). */
  provides?: string[]
  /** Pointer to a successor mod that replaces this one. */
  replaced_by?: RegistryRelationship

  /** External links. */
  resources?: ModResources

  /** Preview image URL (thumbnail for mod browsers). */
  thumbnail?: string

  /** Free-form comment or note — not displayed to users. */
  comment?: string

  /** Localized strings keyed by locale code (e.g. 'de', 'fr'). */
  localizations?: Record<string, { name?: string; abstract?: string; description?: string }>

  /**
   * Component scope — where the mod needs to run:
   * - "client" (default) — BeamNG client mod, installed to mods/repo/
   * - "server" — BeamMP server plugin only, installed to Resources/Server/id/
   * - "both" — has separate client and server components
   *
   * For "both" or "server", the installer supports two distribution models:
   * 1. Outer-zip: main download is a Resources-layout zip (Resources/Client/*.zip + Resources/Server/*\/)
   * 2. Dual-component: separate server_download field for the server plugin
   */
  multiplayer_scope?: 'client' | 'server' | 'both'

  /** URL(s) to the server plugin archive (used when server component is distributed separately). */
  server_download?: string | string[]

  /** SHA256 hash of the server_download archive. */
  server_download_hash?: { sha256: string }

  /** Whether this entry was manually curated (verified) vs auto-scraped. */
  x_verified?: boolean

  /** Extension fields (x_*) for third-party tooling */
  [key: `x_${string}`]: unknown
}

// ── Local Registry Types ──

/** Tracks an installed mod and its provenance */
export interface InstalledRegistryMod {
  /** The full metadata from the registry (or manually constructed) */
  metadata: BeamModMetadata
  /** When this mod was installed (ms since epoch) */
  install_time: number
  /** Was this installed automatically (as a dependency)? */
  auto_installed: boolean
  /** Files installed to disk (relative to userDir) */
  installed_files: string[]
  /** Source: "registry", "beamng_repo", "manual", "server" */
  install_source: 'registry' | 'beamng_repo' | 'manual' | 'server'
}

/** The local registry persisted to disk */
export interface LocalRegistry {
  /** Registry format version for migration support */
  registry_version: number
  /** Map of identifier → installed mod info */
  installed: Record<string, InstalledRegistryMod>
  /** Configured remote repository URLs */
  repositories: RegistryRepository[]
  /** Last time the remote index was fetched (ms since epoch) */
  last_index_update: number | null
}

/** A remote repository configuration */
export interface RegistryRepository {
  name: string
  url: string
  /** Priority for conflict resolution (lower = higher priority) */
  priority: number
}

/** An available mod from the remote index (may have multiple versions) */
export interface AvailableMod {
  identifier: string
  /** All known versions, sorted newest-first */
  versions: BeamModMetadata[]
  /** Total download count (from registry stats) */
  download_count?: number
}

/** The result of a dependency resolution */
export interface ResolutionResult {
  /** Mods to install (in dependency order) */
  to_install: BeamModMetadata[]
  /** Mods to remove (if replacements are needed) */
  to_remove: string[]
  /** Warnings (e.g. recommended mods not included) */
  warnings: string[]
  /** Errors (unresolvable conflicts) */
  errors: string[]
  /** Whether the resolution succeeded */
  success: boolean
}

/** Search/filter criteria for browsing the registry */
export interface RegistrySearchOptions {
  /** Text search across name, abstract, tags, author */
  query?: string
  /** Filter by mod type */
  mod_type?: string
  /** Filter by tag */
  tag?: string
  /** Filter by compatible BeamNG version */
  beamng_version?: string
  /** Sort field */
  sort_by?: 'name' | 'updated' | 'downloads' | 'author'
  /** Sort direction */
  sort_order?: 'asc' | 'desc'
  /** Pagination */
  page?: number
  per_page?: number
}

/** Paginated search result */
export interface RegistrySearchResult {
  mods: AvailableMod[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

/** Status of the registry index */
export interface RegistryStatus {
  /** Whether a remote index is cached locally */
  has_index: boolean
  /** When the index was last updated */
  last_updated: number | null
  /** Number of available mods in the index */
  available_count: number
  /** Number of installed mods tracked by the registry */
  installed_count: number
  /** Whether an update check is in progress */
  updating: boolean
}

/** A modpack export: captures a set of mods and their versions for sharing */
export interface ModpackExport {
  /** Modpack format version */
  format_version: number
  /** Modpack name (user-provided) */
  name: string
  /** Timestamp of export */
  exported_at: string
  /** Mods in this modpack */
  mods: Array<{
    identifier: string
    version: string
    auto_installed: boolean
  }>
}
