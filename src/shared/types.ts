// Shared types used across main and renderer processes

export const DEFAULT_CUSTOM_CSS = ''

export interface GamePaths {
  installDir: string | null
  userDir: string | null
  executable: string | null
  gameVersion: string | null
  /** True when the game runs via Proton/Wine (Linux) — must launch via Steam */
  isProton: boolean
}

export interface AppearanceSettings {
  /** Color mode: 'dark', 'light', or 'system' (follows OS preference) */
  colorMode: 'dark' | 'light' | 'system'
  /** Accent color hex (e.g. '#f97316') */
  accentColor: string
  /** UI scale factor: 0.75 – 1.5 */
  uiScale: number
  /** Base font size in px: 12 – 20 */
  fontSize: number
  /** Background style preset */
  backgroundStyle: 'default' | 'solid' | 'subtle' | 'vibrant'
  /** Surface opacity multiplier: 0.5 – 2.0 */
  surfaceOpacity: number
  /** Border opacity multiplier: 0.5 – 2.0 */
  borderOpacity: number
  /** Enable blur/glassmorphism effects */
  enableBlur: boolean
  /** Custom background gradient color 1 (hex) or null for default */
  bgGradient1: string | null
  /** Custom background gradient color 2 (hex) or null for default */
  bgGradient2: string | null
  /** Sidebar width in px: 160 – 280 */
  sidebarWidth: number
  /** Custom background image file path or null */
  bgImagePath: string | null
  /** Background image blur in px: 0 – 40 */
  bgImageBlur: number
  /** Background image opacity: 0 – 1 */
  bgImageOpacity: number
  /** Saved background image paths (user-added + bundled defaults) */
  bgImageList: string[]
  /** Cycle to a random background on each launch */
  bgCycleOnLaunch: boolean
  /** Ordered list of sidebar page IDs (determines display order) */
  sidebarOrder: AppPage[]
  /** Sidebar items the user has explicitly hidden */
  sidebarHidden: AppPage[]
  /** Custom CSS injected into the app at runtime (legacy — kept for backward compat) */
  customCSS: string
  /** Whether custom CSS is currently active (legacy) */
  customCSSEnabled: boolean

  // ── Visual Customization (replaces raw CSS snippets) ──

  /** Corner radius in px: 0 (square), 8, 12, 16, 24 */
  cornerRadius: number
  /** Button size preset */
  buttonSize: 'default' | 'comfortable' | 'large'
  /** Font family preset */
  fontFamily: 'system' | 'monospace' | 'serif'
  /** Scrollbar visual style */
  scrollbarStyle: 'default' | 'thin-accent' | 'hidden' | 'rounded'
  /** Global animation/transition speed */
  animationSpeed: 'none' | 'normal' | 'slow'
  /** Full-screen overlay effect */
  overlayEffect: 'none' | 'scanlines' | 'vignette' | 'noise'
  /** Border style override */
  borderStyle: 'normal' | 'none' | 'thick' | 'accent'
  /** Smooth fade-in on page transitions */
  effectPageFade: boolean
  /** Extra frosted glass on scrim panels */
  effectFrostedGlass: boolean
  /** Accent-colored text selection */
  effectAccentSelection: boolean
  /** Accent glow on card/surface hover */
  effectHoverGlow: boolean
  /** Cards lift slightly on hover */
  effectHoverLift: boolean
  /** Brightness post-filter: 0.7 – 1.3, default 1.0 */
  filterBrightness: number
  /** Contrast post-filter: 0.7 – 1.5, default 1.0 */
  filterContrast: number
  /** Saturation post-filter: 0.0 – 2.0, default 1.0 */
  filterSaturation: number
  /** How many server rows to render per chunk in the server list. More rows
   * scroll smoother once loaded but cost more on initial render. 100–1000. */
  serverListChunkSize: number
  /** Show hover hint tooltips on sidebar items (on by default for fresh installs) */
  showHints: boolean
}

export interface AppConfig {
  gamePaths: GamePaths
  backendUrl: string
  /** Auth server URL (default: https://auth.beammp.com) */
  authUrl: string
  /** When true, always use official BeamMP backend/auth regardless of URL fields */
  useOfficialBackend: boolean
  launcherPort: number
  theme: 'dark' | 'light'
  /** UI language code (e.g. 'en', 'es', 'fr') */
  language: string
  appearance: AppearanceSettings
  setupComplete: boolean
  /** Whether load-order enforcement via filename prefixes is active */
  loadOrderEnforcement: boolean
  /** Default ports for new server instances (comma-separated ports or ranges like "30814-30820,30900") */
  defaultPorts: string
  /** Manual override for CareerMP save directory */
  careerSavePath: string | null
  /** Custom BeamMP-Server executable path — null = built-in managed copy */
  customServerExe: string | null
  /** Graphics renderer to use when launching BeamNG.drive */
  renderer: 'ask' | 'dx11' | 'vulkan'
  /** Voice chat settings */
  voiceChat: VoiceChatSettings
  /** World Editor Sync (collaborative world editing) settings */
  worldEditSync: WorldEditSyncSettings
}

/**
 * World Editor Sync settings — collaborative world editing over TCP relay.
 *
 * Tier 4 flags are independent phase toggles (see
 * Docs/WORLD-EDITOR-SYNC.md §Rollout). Default all false; when a flag
 * is off the Tier 3 pathway is used for that channel. Hosts choose per
 * session; joiners negotiate via the capability handshake (§A).
 */
export interface WorldEditSyncSettings {
  /**
   * Phase 5 master switch. When `false`, the World Editor Sync UI page
   * is still reachable but `Host` / `Join` buttons short-circuit to a
   * "feature disabled" notice and no Lua extension files are deployed.
   * Default `true` once Phase 5 ships; older configs that predate the
   * field are migrated to `true` on first load (see ConfigService).
   */
  enabled: boolean
  tier4: {
    /** Phase 1 — full reflective field capture (getFieldList) replacing TRACKED_FIELDS */
    reflectiveFields: boolean
    /** Phase 2 — full scenetree snapshot (authoritative baseline) */
    fullSnapshot: boolean
    /** Phase 3 — mod-inventory handshake + on-demand mod shipment */
    modInventory: boolean
    /** Phase 4 — terrain heightmap + forest instance baseline */
    terrainForest: boolean
  }
  /**
   * Tier 4 Phase 3 mod sync. Joiner shows a confirm dialog before any
   * download larger than this threshold (per §3 of the spec). Default
   * 500 MiB; users can lower to 0 to always confirm.
   */
  modSync: {
    confirmThresholdBytes: number
  }
}

export interface ServerInfo {
  ident: string
  sname: string
  ip: string
  port: string
  players: string
  maxplayers: string
  map: string
  sdesc: string
  version: string
  cversion: string
  tags: string
  owner: string
  official: boolean
  featured: boolean
  partner: boolean
  password: boolean
  guests: boolean
  location: string
  modlist: string
  modstotalsize: string
  modstotal: string
  playerslist: string
}

export interface AuthResult {
  success: boolean
  username?: string
  role?: string
  private_key?: string
  public_key?: string
  error?: string
}

export interface ModInfo {
  /** Lowercase key from db.json (e.g. "pikespeak") */
  key: string
  fileName: string
  filePath: string
  sizeBytes: number
  modifiedDate: string
  enabled: boolean
  /** terrain, vehicle, unknown, etc. */
  modType: string
  /** Human-readable title from db.json modData */
  title: string | null
  /** Short tagline / subtitle */
  tagLine: string | null
  /** Mod author username */
  author: string | null
  /** Version string */
  version: string | null
  /** Preview image as data: URL (extracted from zip icon) */
  previewImage: string | null
  /** Location: "repo" or "multiplayer" */
  location: 'repo' | 'multiplayer' | 'other'
  /** BeamNG.com resource ID (if installed from repo browser) */
  resourceId: number | null
  /** Multiplayer deployment scope: client-only, server-only, or both */
  multiplayerScope: 'client' | 'server' | 'both' | null
  /** Load order position (lower = loads first). Assigned by LoadOrderService. */
  loadOrder: number | null
  /** Actual directory name under levels/ inside the zip (for terrain mods) */
  levelDir: string | null
  /**
   * Tier 4 Phase 3 coop mod sharing: if true, this mod is excluded from
   * the `ModManifest` the host advertises to joiners (e.g. paid / closed-
   * license assets). The host still uses it locally; joiners get a
   * "missing mod" warning for any object referencing it.
   */
  noShare?: boolean
}

export interface VehicleInfo {
  id: string
  name: string
  brand: string
  type: string
  source: 'stock' | 'mod'
  modFile?: string
  previewPath?: string
  folderPath: string
}

export interface VehicleDetail {
  id: string
  name: string
  brand: string
  subModel: string
  type: string
  bodyStyle: string
  country: string
  description: string
  author: string
  years: { min: number; max: number } | null
  source: 'stock' | 'mod'
  defaultConfig: string | null
  configCount: number
}

export interface VehicleConfigInfo {
  name: string
  displayName: string
  source: 'stock' | 'user'
  power?: number
  torque?: number
  weight?: number
  drivetrain?: string
  transmission?: string
  topSpeed?: number
  zeroToSixty?: number
  value?: number
  configType?: string
  fuelType?: string
  description?: string
  hasPreview?: boolean
}

export interface VehicleConfigData {
  format?: number
  model?: string
  mainPartName?: string
  licenseName?: string
  parts: Record<string, string>
  vars: Record<string, number>
  paints?: Array<{
    baseColor?: number[]
    clearcoat?: number
    clearcoatRoughness?: number
    metallic?: number
    roughness?: number
  }>
}

export interface SlotOption {
  partName: string
}

export interface SlotInfo {
  name: string
  description: string
  options: SlotOption[]
}

export interface VariableInfo {
  name: string
  type: string
  unit: string
  category: string
  default: number
  min: number
  max: number
  title: string
}

export interface VehicleEditorData {
  slots: Record<string, SlotInfo>
  variables: Record<string, VariableInfo>
}

export interface WheelPlacement {
  meshName: string
  position: [number, number, number]
  group: string
  corner: string
}

/** Result of getActiveVehicleMeshes — mesh names + which part owns each mesh */
export interface ActiveMeshResult {
  meshes: string[]
  meshOwnership: Record<string, string>
}

export interface MapInfo {
  id: string
  name: string
  source: 'stock' | 'mod'
  modFile?: string
  previewPath?: string
  infoPath: string
}

/** Rich metadata for a map, combining BeamNG-native level info + mod registry data */
export interface MapRichMetadata {
  // -- BeamNG-native (from info.json / .terrain.json) --
  /** Human-readable title from info.json (e.g. "West Coast, USA") */
  title?: string
  /** Description/biome text from info.json */
  description?: string
  /** Authors listed in info.json */
  authors?: string[]
  /** Terrain size in meters (from .terrain.json) */
  terrainSize?: number
  /** Number of spawn point groups */
  spawnPointCount?: number
  /** Size of the level zip in bytes */
  fileSize?: number

  // -- Mod registry metadata (from BeamNG-Mod-Registry / .beammod) --
  /** Registry identifier (e.g. "pike_peak_map") */
  registryId?: string
  /** One-line abstract from registry */
  registryAbstract?: string
  /** Long-form Markdown description from registry */
  registryDescription?: string
  /** Registry mod version */
  registryVersion?: string
  /** Registry author(s) */
  registryAuthor?: string | string[]
  /** SPDX license */
  registryLicense?: string | string[]
  /** Categorization tags (e.g. ["open-world", "racing"]) */
  registryTags?: string[]
  /** Release status: stable, testing, development */
  registryReleaseStatus?: 'stable' | 'testing' | 'development'
  /** ISO release date */
  registryReleaseDate?: string
  /** Minimum BeamNG.drive version */
  registryBeamngVersionMin?: string
  /** Maximum BeamNG.drive version */
  registryBeamngVersionMax?: string
  /** Thumbnail URL */
  registryThumbnail?: string
  /** External links */
  registryResources?: {
    homepage?: string
    repository?: string
    bugtracker?: string
    beamng_resource?: string
    beammp_forum?: string
  }
  /** Download size in bytes */
  registryDownloadSize?: number
  /** Install size in bytes */
  registryInstallSize?: number
}

export interface GameStatus {
  running: boolean
  pid: number | null
  connectedServer: string | null
}

export interface RepoMod {
  resourceId: number
  slug: string
  title: string
  version: string
  author: string
  category: string
  categoryId: number
  tagLine: string
  thumbnailUrl: string
  rating: number
  ratingCount: number
  downloads: number
  subscriptions: number
  prefix: string | null
  pageUrl: string
}

export interface RepoBrowseResult {
  mods: RepoMod[]
  currentPage: number
  totalPages: number
}

export type RepoSortOrder =
  | 'last_update'
  | 'resource_date'
  | 'rating_weighted'
  | 'download_count'
  | 'title'

export interface RepoCategory {
  id: number
  slug: string
  label: string
}

export type AppPage =
  | 'home'
  | 'servers'
  | 'friends'
  | 'vehicles'
  | 'maps'
  | 'mods'
  | 'settings'
  | 'server-admin'
  | 'setup'
  | 'launcher'
  | 'controls'
  | 'career'
  | 'live-gps'
  | 'livery-editor'
  | 'voice-chat'
  | 'lua-console'
  | 'world-edit-sync'

export type SupportTicketStatus =
  | 'new'
  | 'triaged'
  | 'in-progress'
  | 'resolved'
  | 'closed'

export type SupportTicketPriority = 'low' | 'normal' | 'high' | 'urgent'

export type SupportTicketSource = 'in-game' | 'desktop' | 'imported'

export interface SupportTicketLocation {
  map?: string
  x?: number
  y?: number
  z?: number
}

export interface SupportTicketSessionMetadata {
  serverName?: string
  serverIdent?: string
  map?: string
  players?: string[]
  playerCount?: number
  sessionId?: string
  startedAt?: number
  endedAt?: number
}

export interface SupportTicketVersions {
  game?: string
  beammp?: string
  launcher?: string
  contentManager?: string
  modPack?: string
}

export interface SupportTicketPcSpecs {
  os?: string
  cpu?: string
  gpu?: string
  ramGb?: number
  vramGb?: number
  storage?: string
}

export interface SupportTicketPayload {
  logsSnapshot?: string
  sessionMetadata?: SupportTicketSessionMetadata
  location?: SupportTicketLocation
  loadedMods?: string[]
  versions?: SupportTicketVersions
  pcSpecs?: SupportTicketPcSpecs
}

export interface SupportTicket {
  id: string
  createdAt: number
  updatedAt: number
  source: SupportTicketSource
  status: SupportTicketStatus
  priority: SupportTicketPriority
  subject: string
  message: string
  reporterName?: string
  reporterBeammpId?: string
  assignedTo?: string
  tags?: string[]
  internalNotes?: string
  payload: SupportTicketPayload
}

export interface SupportTicketCreateInput {
  source?: SupportTicketSource
  priority?: SupportTicketPriority
  subject: string
  message: string
  reporterName?: string
  reporterBeammpId?: string
  tags?: string[]
  payload?: SupportTicketPayload
}

export interface SupportTicketUpdateInput {
  status?: SupportTicketStatus
  priority?: SupportTicketPriority
  subject?: string
  message?: string
  assignedTo?: string
  tags?: string[]
  internalNotes?: string
  payload?: SupportTicketPayload
}

export interface HostedServerSupportIngestConfig {
  enabled: boolean
  port: number
  token: string
  publicHost: string
}

export interface HostedServerSupportTicketUiConfig {
  topics: string[]
  maxMessageLength: number
  enablePriorityDropdown: boolean
  reporterIdentityMode: 'auto' | 'manual'
  includeLogsSnapshot: boolean
  includeSessionMetadata: boolean
  includeLocation: boolean
  includeLoadedMods: boolean
  includeVersions: boolean
  includePcSpecs: boolean
}

export interface HostedServerSupportIngestStatus {
  running: boolean
  senderDeployed: boolean
  config: HostedServerSupportIngestConfig
  endpointPath: string
  endpointExample: string
}

/* ── Hosted Server Manager ── */

export interface HostedServerConfig {
  id: string
  name: string
  port: number
  authKey: string
  maxPlayers: number
  maxCars: number
  map: string
  private: boolean
  description: string
  resourceFolder: string
  tags: string
  allowGuests: boolean
  logChat: boolean
  debug: boolean
  customImage?: string
}

export type HostedServerState = 'stopped' | 'starting' | 'running' | 'error'

export interface HostedServerStatus {
  id: string
  state: HostedServerState
  pid: number | null
  uptimeMs: number
  startedAt: number | null
  players: number
  error: string | null
  memoryBytes: number
  cpuPercent: number
  totalMemoryBytes: number
}

export interface HostedServerEntry {
  config: HostedServerConfig
  status: HostedServerStatus
}

export interface ServerFileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modified?: number
}

export interface ServerFileSearchResult extends ServerFileEntry {
  parentPath: string
}

/* ── Backup Schedule ── */

export type BackupFrequency = 'hourly' | 'daily' | 'weekly'

export interface BackupSchedule {
  enabled: boolean
  frequency: BackupFrequency
  /** Time of day in HH:mm (24h). Used for daily/weekly. */
  timeOfDay: string
  /** 0=Sunday, 1=Monday, ... 6=Saturday. Used for weekly. */
  dayOfWeek: number
  /** Max backups to retain (oldest are deleted). 0 = unlimited. */
  maxBackups: number
  /** Last backup timestamp (ms since epoch), null if never. */
  lastBackup: number | null
  /** Next scheduled backup timestamp (ms since epoch). */
  nextBackup: number | null
}

export interface BackupEntry {
  filename: string
  /** Size in bytes */
  size: number
  /** Created at (ms since epoch) */
  createdAt: number
}

/* ── Scheduled Tasks ── */

export type ScheduledTaskType = 'backup' | 'restart' | 'start' | 'stop' | 'command' | 'message' | 'update'
export type TaskFrequency = 'once' | 'hourly' | 'daily' | 'weekly'

export interface ScheduledTask {
  id: string
  /** Human-readable label */
  label: string
  type: ScheduledTaskType
  enabled: boolean
  frequency: TaskFrequency
  /** Time of day in HH:mm (24h). Used for daily/weekly/once. */
  timeOfDay: string
  /** 0=Sunday ... 6=Saturday. Used for weekly. */
  dayOfWeek: number
  /** Extra config per type — e.g. command text, message text, max backups */
  config: Record<string, string | number | boolean>
  /** Last run timestamp (ms since epoch), null if never. */
  lastRun: number | null
  /** Next scheduled run timestamp (ms since epoch). */
  nextRun: number | null
  /** Last run result summary */
  lastResult: string | null
}

/* ── Server Analytics ── */

export interface PlayerSession {
  sessionId: string
  playerId: number | null
  playerName: string
  joinedAt: number
  leftAt: number | null
  /** Duration in ms (computed when session ends) */
  durationMs: number
  ipAddress: string | null
  beammpId: string | null
  discordId: string | null
  role: string | null
  isGuest: boolean | null
  authAt: number | null
  lastSeenAt: number | null
  endReason: string | null
}

export interface DailyStats {
  /** Date string YYYY-MM-DD */
  date: string
  uniquePlayers: number
  peakPlayers: number
  totalSessionsMs: number
  playerNames: string[]
}

export interface PlayerSummary {
  playerName: string
  totalSessions: number
  totalTimeMs: number
  lastSeen: number
  firstSeen: number
  lastIpAddress: string | null
  uniqueIpCount: number
  knownIps: string[]
  beammpId: string | null
  discordId: string | null
  roles: string[]
  isGuest: boolean
}

export interface IpSummary {
  ipAddress: string
  nickname: string | null
  playerNames: string[]
  totalSessions: number
  totalTimeMs: number
  lastSeen: number
  firstSeen: number
  banned: boolean
  beammpIds: string[]
  discordIds: string[]
  roles: string[]
  isGuest: boolean
}

export interface AnalyticsData {
  dailyStats: DailyStats[]
  playerSummaries: PlayerSummary[]
  ipSummaries: IpSummary[]
  activeSessions: PlayerSession[]
  sessionHistory: PlayerSession[]
  totalSessions: number
  uniqueIpCount: number
}

export type ServerExeStatus = 'ready' | 'missing' | 'downloading'

/* ── Player Heat Map / GPS ── */

export interface GPSWaypoint {
  id: string
  x: number
  y: number
  label?: string
}

export interface GPSRoute {
  id: string
  name: string
  waypoints: GPSWaypoint[]
  color: string
  createdAt: number
  /** Road-following path segments between consecutive waypoints (computed via A*) */
  pathSegments?: { x: number; y: number }[][]
}

export interface PlayerPosition {
  playerId: number
  playerName: string
  vehicleId: number
  x: number
  y: number
  z: number
  heading: number
  speed: number
  timestamp: number
}

/** Telemetry packet from the local GPS tracker vehicle protocol */
export interface GPSPlayerInfo {
  x: number
  y: number
  z: number
  heading: number
  speed: number
  name: string
}

export interface GPSTelemetry {
  x: number
  y: number
  z: number
  heading: number
  speed: number
  timestamp: number
  map?: string
  vehicleId?: string
  otherPlayers?: GPSPlayerInfo[]
  /** Active navigation route — array of 2D waypoints from player to destination */
  navRoute?: Array<{ x: number; y: number }>
}

export interface GPSMapPOI {
  type: 'spawn' | 'gas_station' | 'garage' | 'dealership' | 'shop' | 'restaurant' | 'mechanic' | 'waypoint'
  name: string
  x: number
  y: number
}

/* ── World Editor Sync (Phase 0 spike) ── */

/**
 * Status snapshot reported by beamcmEditorSync.lua via
 * settings/BeamCM/we_capture_status.json. Phase 0 only — Phase 1+ replaces
 * this with a richer session model.
 */
export interface EditorSyncStatus {
  /** True if hooks are installed and we are recording editor.history actions. */
  capturing: boolean
  /** Number of actions captured in the current session. */
  captureCount: number
  /** True if a replay is currently being stepped through. */
  replayActive: boolean
  /** 1-based index into the replay queue; 0 if not replaying. */
  replayIndex: number
  /** Total entries in the replay queue (0 if not replaying). */
  replayTotal: number
  /** True if the editor.history wrappers are currently installed. */
  hooked: boolean
  /** True if the editor module is present in BeamNG (i.e. world editor is reachable). */
  editorPresent: boolean
  /** Currently loaded level name (e.g. "gridmap_v2"), null if not in a level. */
  levelName?: string | null
}

/** One line of `we_capture.log` parsed to JSON. */
export interface EditorSyncCaptureEntry {
  kind: 'do' | 'undo' | 'redo' | 'tx-begin' | 'tx-end'
  name?: string
  data?: unknown
  /**
   * Per-action human-readable detail extracted on the Lua side.
   * E.g. "#1234 TSStatic foo", "field=position on 3 objects", "[12, 14, 19]".
   * Short, one-line, safe to render in the UI table without further parsing.
   */
  detail?: string
  /** Action-specific target ids (object ids, road ids, ...). Empty if N/A. */
  targets?: number[]
  ts: number
  seq: number
}

/** A saved editor-session snapshot (a copy of a level with user edits applied). */
export interface EditorProject {
  /** Project display name (user-supplied). */
  name: string
  /** Source level name the project was forked from, e.g. "gridmap_v2". */
  levelName: string
  /** Full absolute path to the project directory under <userDir>/levels/_beamcm_projects/. */
  path: string
  /** BeamNG-style level path to feed to core_levels.startLevel, e.g. "/levels/_beamcm_projects/gridmap_v2__foo/". */
  levelPath: string
  /** Last-modified timestamp (ms since epoch) of the project folder. */
  mtime: number
  /** Approximate size in bytes. */
  sizeBytes: number
}

/** Collaborative world-editor session state (mirrors EditorSyncSessionController). */
export type SessionState = 'idle' | 'hosting' | 'joined' | 'connecting'

export interface SessionStatus {
  state: SessionState
  authorId: string
  displayName: string
  sessionId: string | null
  host: string | null
  port: number | null
  /** Only populated when hosting — indicates a token is expected from joiners. */
  token: string | null
  levelName: string | null
  lastSeq: number
  peers: Array<{ authorId: string; displayName: string; remote?: string }>
  bridgeReady: boolean
  opsIn: number
  opsOut: number
  /** Host-only: current auth mode; null when idle or joined. */
  authMode: 'open' | 'token' | 'approval' | 'friends' | null
  /** Host-only: joiners awaiting host approval. */
  pendingApprovals: Array<{
    authorId: string
    displayName: string
    beamUsername: string | null
    remote: string
  }>
  /** Host-only: shareable session code (base64 encoded + "BEAMCM2:" prefix). */
  sessionCode: string | null
  /**
   * Project the host is offering for peers to download. Host-side: populated
   * after `worldEdit:session:setActiveProject` + initial zip/hash build.
   * Joiner-side: populated from the welcome frame so the UI can prompt the
   * user to download + install + load the host's saved project.
   */
  project?: SessionProjectInfo | null
  /** Joiner-side: download progress of the current project transfer (0..1). */
  projectDownload?: { received: number; total: number; done: boolean; error?: string } | null
  /** Joiner-side: true once the downloaded project has been installed locally. */
  projectInstalledPath?: string | null
}

/**
 * Metadata about the host's "active project" — the one a joiner can download
 * and apply locally to get the same starting point. Served by the relay over
 * HTTP on `httpPort` as `GET /project.zip`.
 */
export interface SessionProjectInfo {
  /** Short human name, e.g. "coop_20260421_1905". */
  name: string
  /** BeamNG source level the project is derived from, e.g. "gridmap_v2". */
  levelName: string
  /** Folder name under `<userDir>/levels/_beamcm_projects/` on the host. */
  folder: string
  /** SHA-256 of the zipped project bytes. */
  sha256: string
  /** Size of the .zip payload in bytes. */
  sizeBytes: number
  /** TCP port the host exposes its HTTP download endpoint on. */
  httpPort: number
  /**
   * Per-session bearer token the joiner must supply as `?token=…` when
   * downloading the zip. Minted by the host relay at start time.
   */
  authToken: string
}

/** Op envelope as it crosses the CM-to-CM wire and is surfaced to the renderer. */
export interface SessionOp {
  type: 'op'
  seq: number
  authorId: string
  clientOpId?: string
  kind: 'do' | 'undo' | 'redo'
  name?: string
  data?: unknown
  detail?: string
  targets?: unknown[]
  ts?: number
}

/** Server-log entry surfaced by the session controller to the renderer. */
export interface SessionLogEntry {
  ts: number
  level: 'info' | 'warn' | 'error'
  source: 'relay' | 'peer' | 'bridge' | 'session' | 'snapshot'
  message: string
}

/** Live pose of a peer (or the local user, marked `self: true`). */
export interface PeerPoseEntry {
  authorId: string
  displayName: string
  ts: number
  x: number
  y: number
  z: number
  heading?: number
  inVehicle?: boolean
  vehicle?: string
  levelName?: string | null
  self?: boolean
}

/** Most-recent edit performed by a peer (or local user). */
export interface PeerActivity {
  authorId: string
  displayName: string
  ts: number
  name?: string
  kind: 'do' | 'undo' | 'redo'
  detail?: string
}

/* ── Mod Load Order ── */

export interface LoadOrderData {
  version: 1
  /** Map of modKey → load-order position (0-based, lower = loads first) */
  orders: Record<string, number>
}

/* ── Mod Conflict Detection ── */

export interface ModConflict {
  /** The file path inside the zip that overlaps */
  filePath: string
  /** Mods that contain this file, with their load order and enabled state */
  mods: Array<{ modKey: string; loadOrder: number; enabled: boolean }>
  /** The mod whose version of the file is used (highest load order = last loaded = wins) */
  winner: string
}

export interface ModConflictReport {
  conflicts: ModConflict[]
  /** Mod keys that were scanned */
  scannedMods: string[]
  /** When the scan was performed */
  timestamp: number
}

/* ══════════════════════════════════════════════════════════════
   Controls Editor Types
   ══════════════════════════════════════════════════════════════ */

export type InputDeviceType = 'keyboard' | 'mouse' | 'xinput' | 'joystick'

export interface InputDevice {
  /** File name without extension (e.g. "keyboard", "0004346E") */
  fileName: string
  name: string
  vendorName?: string
  devicetype: InputDeviceType
  vidpid: string
  guid?: string
  displayName?: string
  imagePack?: string
  /** True if a user .diff file exists for this device */
  hasUserOverrides: boolean
}

export interface FFBConfig {
  forceCoef: number
  smoothing: number
  smoothing2: number
  smoothing2automatic: boolean
  lowspeedCoef: boolean
  responseCorrected: boolean
  responseCurve: [number, number][]
  updateType: number
}

export interface InputBinding {
  control: string
  action: string
  /** Axis linearity (0.2–5.0) — only for analog axes */
  linearity?: number
  /** Deadzone start (0–1) */
  deadzone?: number
  /** Deadzone resting point (0–1) */
  deadzoneResting?: number
  /** Deadzone end (0–1) */
  deadzoneEnd?: number
  /** Invert axis */
  isInverted?: boolean
  /** Steering angle for wheels */
  angle?: number
  /** Force feedback enabled */
  isForceEnabled?: boolean
  /** Force feedback config */
  ffb?: FFBConfig
  /** Whether this binding was removed by user */
  isRemoved?: boolean
  /** Whether this is a user override vs default */
  isUserOverride?: boolean
}

export interface InputAction {
  /** Action ID (e.g. "accelerate", "steering") */
  id: string
  /** Category key (e.g. "vehicle", "camera") */
  cat: string
  /** Sort order within category */
  order: number
  /** Title translation key */
  title: string
  /** Description translation key */
  desc?: string
  /** Whether axis returns to center */
  isCentered?: boolean
  /** Context: vlua, ts, etc. */
  ctx?: string
}

export interface ActionCategory {
  /** Category ID (e.g. "vehicle", "camera") */
  id: string
  /** Display name */
  name: string
  /** Sort order */
  order: number
}

export interface MergedDeviceBindings {
  device: InputDevice
  bindings: InputBinding[]
}

export interface SteeringFilterSettings {
  /* Keyboard / Gamepad filters */
  steeringAutocenterEnabled: boolean
  steeringSlowdownEnabled: boolean
  steeringSlowdownStartSpeed: number
  steeringSlowdownEndSpeed: number
  steeringSlowdownMultiplier: number
  steeringLimitEnabled: boolean
  steeringLimitMultiplier?: number
  steeringStabilizationEnabled: boolean
  steeringStabilizationMultiplier: number
  steeringUndersteerReductionEnabled: boolean
  steeringUndersteerReductionMultiplier: number
  /* Direct Input / Wheel (same keys with "Direct" suffix) */
  steeringAutocenterEnabledDirect: boolean
  steeringSlowdownEnabledDirect: boolean
  steeringSlowdownStartSpeedDirect: number
  steeringSlowdownEndSpeedDirect: number
  steeringSlowdownMultiplierDirect: number
  steeringLimitEnabledDirect: boolean
  steeringLimitMultiplierDirect?: number
  steeringStabilizationEnabledDirect: boolean
  steeringStabilizationMultiplierDirect: number
  steeringUndersteerReductionEnabledDirect: boolean
  steeringUndersteerReductionMultiplierDirect: number
}

/* ── Livery Editor ── */

export interface SkinMaterialInfo {
  materialName: string
  texturePath: string
  uvChannel: 0 | 1
  hasPaletteMap: boolean
}

export interface LiveryExportParams {
  vehicleName: string
  skinName: string
  authorName: string
  canvasDataUrl: string
  metallic: number
  roughness: number
  clearcoat: number
  clearcoatRoughness: number
}

export interface LiveryProjectData {
  version: number
  vehicleName: string
  vehicleDisplayName: string
  templateWidth: number
  templateHeight: number
  canvasJson: string
  layerMeta: Array<{
    name: string
    visible: boolean
    locked: boolean
    opacity: number
  }>
}

export type ControlsTab = 'bindings' | 'axes' | 'ffb' | 'filters' | 'presets' | 'liveInput'

export interface ControlsPreset {
  id: string
  name: string
  createdAt: number
  deviceVidpid?: string
  deviceName?: string
  devicetype?: InputDeviceType
  /** Map of diff filenames to their contents */
  diffs: Record<string, string>
}

export type ConflictResolution = 'cancel' | 'replace' | 'bindBoth' | 'swap'

export interface BindingConflict {
  /** The control that's already bound */
  control: string
  /** Actions currently using this control */
  existingActions: string[]
  /** The new action being bound */
  newAction: string
}

export interface LiveInputState {
  axes: Record<string, number>
  buttons: Record<string, boolean>
}

/* ══════════════════════════════════════════════════════════════
   Voice Chat Types
   ══════════════════════════════════════════════════════════════ */

export type VoiceChatMode = 'ptt' | 'vad'

export interface VoiceChatSettings {
  /** Whether voice chat is enabled */
  enabled: boolean
  /** Input device ID (from navigator.mediaDevices) — null = system default */
  inputDeviceId: string | null
  /** Input gain multiplier: 0.0 – 3.0 */
  inputGain: number
  /** Output volume: 0.0 – 1.0 */
  outputVolume: number
  /** Output device ID (from navigator.mediaDevices) — null = system default */
  outputDeviceId: string | null
  /** Activation mode: push-to-talk or voice activity detection */
  mode: VoiceChatMode
  /** Key code for push-to-talk (e.g. 'KeyV') */
  pttKey: string
  /** Voice activity detection threshold: 0.0 – 1.0 */
  vadThreshold: number
  /** Proximity range in meters (distance beyond which audio is silent) */
  proximityRange: number
  /** Optional TURN server URL for users behind symmetric NATs (e.g. 'turn:my.turn.server:3478') */
  turnServerUrl: string | null
  /** TURN server username (if required) */
  turnUsername: string | null
  /** TURN server credential (if required) */
  turnCredential: string | null
}

export interface VoiceSignalMessage {
  event: string
  data: string
}

export interface VoicePeerInfo {
  playerId: number
  playerName: string
  speaking: boolean
}

export interface VoiceChatState {
  available: boolean
  enabled: boolean
  connected: boolean
  peers: VoicePeerInfo[]
}
