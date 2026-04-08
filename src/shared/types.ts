// Shared types used across main and renderer processes

export interface GamePaths {
  installDir: string | null
  userDir: string | null
  executable: string | null
  gameVersion: string | null
  /** True when the game runs via Proton/Wine (Linux) — must launch via Steam */
  isProton: boolean
}

export interface AppearanceSettings {
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
  /** Custom CSS injected into the app at runtime */
  customCSS: string
  /** Whether custom CSS is currently active */
  customCSSEnabled: boolean
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
  /** Default ports for new server instances (comma-separated ports or ranges like "30814-30820,30900") */
  defaultPorts: string
  /** Manual override for CareerMP save directory */
  careerSavePath: string | null
  /** Custom BeamMP-Server executable path — null = built-in managed copy */
  customServerExe: string | null
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
  playerName: string
  joinedAt: number
  leftAt: number | null
  /** Duration in ms (computed when session ends) */
  durationMs: number
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
}

export interface AnalyticsData {
  dailyStats: DailyStats[]
  playerSummaries: PlayerSummary[]
  activeSessions: PlayerSession[]
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
