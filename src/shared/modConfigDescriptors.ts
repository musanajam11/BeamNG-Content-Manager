// Descriptors for "drop-in" server-side mod configurations that the
// Server Manager surfaces under the Configuration tab. Each descriptor
// names a directory (relative to the server root) whose JSON files we
// auto-discover and render as editable forms — no hard-coded field list,
// so newly added settings appear automatically.

export interface ModConfigDescriptor {
  /** Stable, machine-readable id (used in IPC + locale keys). */
  id: string
  /** Human-readable label for the section header. */
  displayName: string
  /** One-liner under the header. */
  blurb?: string
  /** Path under <serverDir> that contains the JSON config files. */
  dirRelative: string
  /**
   * Existence of any of these paths (relative to <serverDir>) marks the
   * mod as installed for the server. Falls back to `dirRelative` if not
   * provided.
   */
  installMarkers?: string[]
  /**
   * Optional explicit allowlist of files to expose. When omitted we
   * enumerate every `.json` file inside `dirRelative` (non-recursive).
   */
  files?: string[]
}

export const MOD_CONFIG_DESCRIPTORS: ModConfigDescriptor[] = [
  {
    id: 'careermp',
    displayName: 'CareerMP',
    blurb: 'Auto-detected from Resources/Server/CareerMP/config/',
    dirRelative: 'Resources/Server/CareerMP/config',
    installMarkers: ['Resources/Server/CareerMP'],
  },
  {
    id: 'cobalt-essentials',
    displayName: 'Cobalt Essentials',
    blurb: 'Auto-detected from Resources/Server/CobaltEssentials/CobaltDB/',
    dirRelative: 'Resources/Server/CobaltEssentials/CobaltDB',
    installMarkers: ['Resources/Server/CobaltEssentials'],
  },
]

export interface ModConfigFile {
  /** Path relative to the descriptor's `dirRelative`. */
  relPath: string
  exists: boolean
  /** Parsed JSON content (null if file missing or unparseable). */
  content: unknown
  /** Raw text — handy if parse failed and we want to show the error. */
  raw?: string
  parseError?: string
}

export interface ModConfigBundle {
  descriptorId: string
  installed: boolean
  /** Absolute resolved directory (debugging only — UI shows it as a path hint). */
  absDir: string
  files: ModConfigFile[]
}
