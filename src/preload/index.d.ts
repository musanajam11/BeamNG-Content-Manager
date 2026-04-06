import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppConfig, GamePaths, ServerInfo, AuthResult, GameStatus, ModInfo, RepoBrowseResult, RepoCategory, RepoSortOrder, VehicleDetail, VehicleConfigInfo, VehicleConfigData, HostedServerConfig, HostedServerStatus, HostedServerEntry, ServerFileEntry, ServerExeStatus, GPSRoute, PlayerPosition, BackupSchedule, BackupEntry, ScheduledTask, AnalyticsData, AppearanceSettings, MapRichMetadata } from '../shared/types'
import type { RegistryStatus, RegistrySearchOptions, RegistrySearchResult, AvailableMod, InstalledRegistryMod, ResolutionResult, RegistryRepository, BeamModMetadata, ModpackExport } from '../shared/registry-types'

interface AppAPI {
  // Config
  getConfig(): Promise<AppConfig>
  updateConfig(partial: Partial<AppConfig>): Promise<void>
  markSetupComplete(): Promise<void>

  // Appearance
  setZoomFactor(factor: number): Promise<void>
  getZoomFactor(): Promise<number>
  pickBackgroundImage(): Promise<string | null>
  loadBackgroundImage(filePath: string): Promise<string | null>
  getDefaultBackgrounds(): Promise<string[]>
  loadBackgroundThumb(filePath: string): Promise<string | null>

  // Versions
  getVersions(): Promise<{ appVersion: string; gameVersion: string | null; launcherVersion: string; serverVersion: string | null }>

  // Game Discovery
  discoverPaths(): Promise<GamePaths | null>
  validatePaths(paths: GamePaths): Promise<{ valid: boolean; errors: string[] }>
  setCustomPaths(installDir: string, userDir: string): Promise<GamePaths>

  // Game Launcher
  launchGame(): Promise<{ success: boolean; error?: string }>
  launchVanilla(config?: { mode?: string; level?: string; vehicle?: string }): Promise<{ success: boolean; error?: string }>
  listMaps(): Promise<{ name: string; source: 'stock' | 'mod'; modZipPath?: string }[]>
  listVehicles(): Promise<{
    name: string; displayName: string; brand: string; type: string;
    bodyStyle: string; country: string; source: 'stock' | 'mod'; configCount: number
  }[]>
  getVehiclePreview(vehicleName: string): Promise<string | null>
  getVehicleDetail(vehicleName: string): Promise<VehicleDetail | null>
  getVehicleConfigs(vehicleName: string): Promise<VehicleConfigInfo[]>
  getVehicleConfigPreview(vehicleName: string, configName: string): Promise<string | null>
  getVehicleConfigData(vehicleName: string, configName: string): Promise<VehicleConfigData | null>
  saveVehicleConfig(vehicleName: string, configName: string, data: VehicleConfigData): Promise<{ success: boolean; error?: string }>
  deleteVehicleConfig(vehicleName: string, configName: string): Promise<{ success: boolean; error?: string }>
  renameVehicleConfig(vehicleName: string, oldName: string, newName: string): Promise<{ success: boolean; error?: string }>
  getVehicle3DModel(vehicleName: string, activeMeshes?: string[]): Promise<string[]>
  getActiveVehicleMeshes(vehicleName: string, configParts: Record<string, string>): Promise<string[]>
  getWheelPlacements(vehicleName: string, configParts: Record<string, string>): Promise<Array<{ meshName: string; position: [number, number, number]; group: string; corner: string }>>
  getVehicleEditorData(vehicleName: string): Promise<unknown>
  getVehicleMaterials(vehicleName: string): Promise<Record<string, unknown>>
  getActiveGlobalSkin(vehicleName: string, configParts: Record<string, string>): Promise<{ skin: string; slotType: string } | null>
  getVehicleDefaultPaints(vehicleName: string, configName: string): Promise<Array<{ baseColor: number[]; metallic: number; roughness: number; clearcoat: number; clearcoatRoughness: number }>>
  killGame(): Promise<void>
  getGameStatus(): Promise<GameStatus>
  joinServer(ip: string, port: number): Promise<{ success: boolean; error?: string }>
  beammpLogin(username: string, password: string): Promise<{ success: boolean; username?: string; error?: string }>
  beammpLoginAsGuest(): Promise<void>
  beammpLogout(): Promise<void>
  getAuthInfo(): Promise<{ authenticated: boolean; username: string; guest: boolean }>
  getLauncherLogs(): Promise<string[]>

  // Backend
  getServers(): Promise<{ success: boolean; data?: ServerInfo[]; error?: string }>
  login(username: string, password: string): Promise<AuthResult>
  checkBackendHealth(): Promise<boolean>
  setBackendUrl(url: string): Promise<void>

  // Map Preview
  getMapPreview(mapPath: string, modZipPath?: string): Promise<string | null>

  // Map Minimap (top-down overhead image)
  getMapMinimap(mapPath: string): Promise<{ dataUrl: string; worldBounds?: { minX: number; maxX: number; minY: number; maxY: number } } | null>

  // Map Terrain Base
  getMapTerrainBase(mapPath: string, modZipPath?: string): Promise<string | null>

  // Map Heightmap
  getMapHeightmap(mapPath: string): Promise<string | null>

  // Map Terrain Info
  getMapTerrainInfo(mapPath: string): Promise<{ size: number } | null>

  // Map Rich Metadata (info.json + .terrain.json + mod registry)
  getMapMetadata(mapName: string, modZipPath?: string): Promise<MapRichMetadata>

  // Map Road Route (A* pathfinding along roads)
  findMapRoute(mapPath: string, startX: number, startY: number, endX: number, endY: number): Promise<{ x: number; y: number }[]>

  // Flag Images (cached)
  getFlags(codes: string[]): Promise<Record<string, string>>

  // Favorites
  getFavorites(): Promise<string[]>
  setFavorite(ident: string, favorite: boolean): Promise<string[]>

  // Recent Servers
  getRecentServers(): Promise<Array<{ ident: string; timestamp: number }>>

  // Mods
  getMods(): Promise<{ success: boolean; data?: ModInfo[]; error?: string }>
  toggleMod(modKey: string, enabled: boolean): Promise<{ success: boolean; error?: string }>
  deleteMod(modKey: string): Promise<{ success: boolean; error?: string }>
  installMod(): Promise<{ success: boolean; data?: ModInfo[]; error?: string }>
  openModsFolder(): Promise<void>
  getModPreview(filePath: string): Promise<{ success: boolean; data?: string | null }>

  // Mod Repository
  browseRepoMods(
    categoryId: number,
    page: number,
    sort: RepoSortOrder
  ): Promise<{ success: boolean; data?: RepoBrowseResult; error?: string }>
  searchRepoMods(
    query: string,
    page: number
  ): Promise<{ success: boolean; data?: RepoBrowseResult; error?: string }>
  getRepoCategories(): Promise<RepoCategory[]>
  openModPage(url: string): Promise<void>
  downloadRepoMod(
    resourceId: number,
    slug: string
  ): Promise<{ success: boolean; fileName?: string; error?: string }>
  onRepoDownloadProgress(
    callback: (progress: { received: number; total: number; fileName: string }) => void
  ): () => void
  getRepoThumbnails(urls: string[]): Promise<Record<string, string>>
  beamngWebLogin(): Promise<{ success: boolean }>
  beamngWebLoggedIn(): Promise<{ loggedIn: boolean; username: string }>
  beamngWebLogout(): Promise<void>

  // Window Controls
  minimizeWindow(): void
  maximizeWindow(): void
  closeWindow(): void
  isMaximized(): Promise<boolean>
  onMaximizedChange(callback: (maximized: boolean) => void): () => void

  // Server Queue (Wait-to-Join)
  queueStart(ip: string, port: string, sname: string): Promise<{ success: boolean }>
  queueStop(): Promise<{ cancelled: boolean; ip?: string; port?: string }>
  queueGetStatus(): Promise<{
    active: boolean
    ip: string | null
    port: string | null
    sname: string | null
    elapsed: number
  }>
  onQueueStatus(callback: (status: {
    active: boolean
    ip: string
    port: string
    sname: string
    elapsed: number
    players?: number
    maxPlayers?: number
    message: string
  }) => void): () => void
  onQueueJoined(callback: (result: {
    success: boolean
    error?: string
    ip: string
    port: string
    sname: string
  }) => void): () => void
  onModSyncProgress(callback: (progress: {
    phase: 'downloading' | 'loading' | 'done'
    modIndex: number
    modCount: number
    fileName: string
    received: number
    total: number
  }) => void): () => void

  // Hosted Server Manager
  hostedServerList(): Promise<HostedServerEntry[]>
  hostedServerCreate(partial?: Partial<HostedServerConfig>): Promise<HostedServerConfig>
  hostedServerUpdate(id: string, partial: Partial<HostedServerConfig>): Promise<HostedServerConfig>
  hostedServerDelete(id: string): Promise<void>
  hostedServerStart(id: string): Promise<{ success: boolean; error?: string }>
  hostedServerStop(id: string): Promise<{ success: boolean }>
  hostedServerRestart(id: string): Promise<{ success: boolean; error?: string }>
  hostedServerGetConsole(id: string): Promise<string[]>
  hostedServerSendCommand(id: string, command: string): Promise<void>
  hostedServerGetExeStatus(): Promise<ServerExeStatus>
  hostedServerDownloadExe(): Promise<{ success: boolean; error?: string }>
  hostedServerInstallExe(sourcePath: string): Promise<string>
  hostedServerBrowseExe(): Promise<string | null>
  hostedServerListFiles(id: string, subPath?: string): Promise<ServerFileEntry[]>
  hostedServerDeployedMods(id: string): Promise<string[]>
  hostedServerUndeployMod(id: string, modFileName: string): Promise<void>
  hostedServerGetServersWithMod(modFileName: string): Promise<Array<{ id: string; name: string }>>
  hostedServerDeleteFile(id: string, filePath: string): Promise<void>
  hostedServerCreateFolder(id: string, folderPath: string): Promise<void>
  hostedServerCopyMod(id: string, modFilePath: string): Promise<string>
  hostedServerAddFiles(id: string, destSubPath: string): Promise<string[]>
  hostedServerReadFile(id: string, filePath: string): Promise<string>
  hostedServerWriteFile(id: string, filePath: string, content: string): Promise<void>
  hostedServerExtractZip(id: string, zipPath: string): Promise<{ success: boolean; extracted: number }>
  hostedServerTestPort(port: number): Promise<{ open: boolean; ip?: string; error?: string }>
  hostedServerSaveCustomImage(id: string, dataUrl: string): Promise<string>
  hostedServerRemoveCustomImage(id: string): Promise<void>
  hostedServerGetCustomImage(id: string): Promise<string | null>
  hostedServerGetRoutes(id: string): Promise<GPSRoute[]>
  hostedServerSaveRoute(id: string, route: GPSRoute): Promise<GPSRoute[]>
  hostedServerDeleteRoute(id: string, routeId: string): Promise<GPSRoute[]>
  hostedServerGetPlayerPositions(id: string): Promise<PlayerPosition[]>
  hostedServerDeployTracker(id: string): Promise<void>

  // Backup Schedule
  hostedServerGetSchedule(id: string): Promise<BackupSchedule>
  hostedServerSaveSchedule(id: string, schedule: Partial<BackupSchedule>): Promise<BackupSchedule>
  hostedServerCreateBackup(id: string): Promise<BackupEntry>
  hostedServerListBackups(id: string): Promise<BackupEntry[]>
  hostedServerDeleteBackup(id: string, filename: string): Promise<void>
  hostedServerRestoreBackup(id: string, filename: string): Promise<void>

  // Scheduled Tasks
  hostedServerGetTasks(id: string): Promise<ScheduledTask[]>
  hostedServerSaveTask(id: string, task: ScheduledTask): Promise<ScheduledTask[]>
  hostedServerCreateTask(id: string, task: Omit<ScheduledTask, 'id' | 'lastRun' | 'nextRun' | 'lastResult'>): Promise<ScheduledTask[]>
  hostedServerDeleteTask(id: string, taskId: string): Promise<ScheduledTask[]>
  hostedServerRunTaskNow(id: string, taskId: string): Promise<ScheduledTask[]>

  // Analytics
  hostedServerGetAnalytics(id: string): Promise<AnalyticsData>
  hostedServerClearAnalytics(id: string): Promise<void>
  hostedServerUpdatePlayerTracking(id: string, playerNames: string[]): Promise<void>
  hostedServerEndAllSessions(id: string): Promise<void>

  onHostedServerConsole(callback: (data: { serverId: string; lines: string[] }) => void): () => void
  onLauncherLog(callback: (line: string) => void): () => void
  onHostedServerStatusChange(callback: (status: HostedServerStatus) => void): () => void
  onHostedServerExeStatus(callback: (status: ServerExeStatus) => void): () => void

  // Mod Registry
  registryGetStatus(): Promise<RegistryStatus>
  registryUpdateIndex(): Promise<{ updated: boolean; error?: string }>
  registrySearch(options: RegistrySearchOptions): Promise<RegistrySearchResult>
  registryGetMod(identifier: string): Promise<AvailableMod | null>
  registryGetUpdatesAvailable(): Promise<Array<{ identifier: string; installed: string; latest: string; mod: BeamModMetadata }>>
  registryGetInstalled(): Promise<Record<string, InstalledRegistryMod>>
  registryResolve(identifiers: string[]): Promise<ResolutionResult>
  registryCheckReverseDeps(identifiers: string[]): Promise<string[]>
  registryInstall(identifiers: string[], targetServerId?: string): Promise<{ success: boolean; error?: string; installed?: string[] }>
  registryTrackInstall(metadata: BeamModMetadata, installedFiles: string[], source: string, autoInstalled: boolean): Promise<void>
  registryTrackRemoval(identifier: string): Promise<void>
  registryGetRepositories(): Promise<RegistryRepository[]>
  registrySetRepositories(repos: RegistryRepository[]): Promise<void>
  registryExportModpack(name: string): Promise<ModpackExport>
  registryImportModpack(modpackJson: string): Promise<{ identifiers: string[]; missing: string[]; error?: string }>
  registryGetSupporters(identifier: string): Promise<BeamModMetadata[]>
  onRegistryDownloadProgress(
    callback: (progress: { identifier: string; received: number; total: number; fileName: string }) => void
  ): () => void

  // News feed
  getNewsFeed(): Promise<
    Array<{
      id: string
      source: 'steam' | 'beammp'
      title: string
      url: string
      date: number
      summary: string
    }>
  >

  // Tailscale
  getTailscaleStatus(): Promise<{
    installed: boolean
    running: boolean
    ip: string | null
    hostname: string | null
    tailnet: string | null
    peers: Array<{ hostname: string; ip: string; os: string; online: boolean }>
  }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
