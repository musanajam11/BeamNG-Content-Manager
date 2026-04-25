import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppConfig, GamePaths, ServerInfo, AuthResult, GameStatus, ModInfo, RepoBrowseResult, RepoCategory, RepoSortOrder, VehicleDetail, VehicleConfigInfo, VehicleConfigData, HostedServerConfig, HostedServerStatus, HostedServerEntry, ServerFileEntry, ServerFileSearchResult, ServerExeStatus, GPSRoute, PlayerPosition, BackupSchedule, BackupEntry, ScheduledTask, AnalyticsData, IpSummary, MapRichMetadata, LoadOrderData, ModConflictReport, SupportTicket, SupportTicketCreateInput, SupportTicketUpdateInput, HostedServerSupportIngestConfig, HostedServerSupportIngestStatus, HostedServerSupportTicketUiConfig } from '../shared/types'
import type { RegistryStatus, RegistrySearchOptions, RegistrySearchResult, AvailableMod, InstalledRegistryMod, ResolutionResult, RegistryRepository, BeamModMetadata, ModpackExport } from '../shared/registry-types'

export interface CareerMPServerConfig {
  server: {
    autoUpdate: boolean
    autoRestart: boolean
    allowTransactions: boolean
    sessionSendingMax: number
    sessionReceiveMax: number
    shortWindowMax: number
    shortWindowSeconds: number
    longWindowMax: number
    longWindowSeconds: number
    [key: string]: unknown
  }
  client: {
    allGhost: boolean
    unicycleGhost: boolean
    serverSaveName: string
    serverSaveSuffix: string
    serverSaveNameEnabled: boolean
    roadTrafficAmount: number
    parkedTrafficAmount: number
    roadTrafficEnabled: boolean
    parkedTrafficEnabled: boolean
    worldEditorEnabled: boolean
    consoleEnabled: boolean
    simplifyRemoteVehicles: boolean
    spawnVehicleIgnitionLevel: number
    skipOtherPlayersVehicles: boolean
    trafficSmartSelections: boolean
    trafficSimpleVehicles: boolean
    trafficAllowMods: boolean
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface DynamicTrafficConfig {
  aisPerPlayer: number
  maxServerTraffic: number
  trafficGhosting: boolean
  trafficSpawnWarnings: boolean
}

export interface HostedServerModGateConfig {
  enabled: boolean
  allowedArchives: string[]
  allowedVehicleNames: string[]
  stockVehicleNames: string[]
  serverVehicleNames: string[]
  vehicleDisplayNames?: Record<string, string>
  vehicleDeniedNames: string[]
  vehicleForcedAllowedNames: string[]
  updatedAt: string
}

interface AppAPI {
  // Config
  getConfig(): Promise<AppConfig>
  updateConfig(partial: Partial<AppConfig>): Promise<void>
  markSetupComplete(): Promise<void>
  browseServerExe(): Promise<string | null>

  // Appearance
  setZoomFactor(factor: number): Promise<void>
  getZoomFactor(): Promise<number>
  pickBackgroundImage(): Promise<string | null>
  loadBackgroundImage(filePath: string): Promise<string | null>
  getDefaultBackgrounds(): Promise<string[]>
  deleteDefaultBackground(filePath: string): Promise<boolean>
  loadBackgroundThumb(filePath: string): Promise<string | null>

  // Versions
  getVersions(): Promise<{ appVersion: string; gameVersion: string | null; launcherVersion: string; serverVersion: string | null }>

  // Game Discovery
  discoverPaths(): Promise<GamePaths | null>
  validatePaths(paths: GamePaths): Promise<{ valid: boolean; errors: string[] }>
  setCustomPaths(installDir: string, userDir: string): Promise<GamePaths>

  // Discord
  discordSetPage(pageId: string): void
  discordSetPlaying(info: {
    serverName: string
    mapName: string
    carName?: string
    tags?: string
    playerCount?: number
    maxPlayers?: number
  }): void
  discordClearPlaying(): void

  // Game Launcher
  launchGame(): Promise<{ success: boolean; error?: string }>
  launchVanilla(config?: { mode?: string; level?: string; vehicle?: string }): Promise<{ success: boolean; error?: string }>
  listMaps(): Promise<{ name: string; source: 'stock' | 'mod'; modZipPath?: string; levelDir?: string; modKey?: string }[]>
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
  getActiveVehicleMeshes(vehicleName: string, configParts: Record<string, string>): Promise<{ meshes: string[]; meshOwnership: Record<string, string> }>
  getWheelPlacements(vehicleName: string, configParts: Record<string, string>): Promise<Array<{ meshName: string; position: [number, number, number]; group: string; corner: string }>>
  getVehicleEditorData(vehicleName: string): Promise<unknown>
  getVehicleMaterials(vehicleName: string): Promise<Record<string, unknown>>
  getActiveGlobalSkin(vehicleName: string, configParts: Record<string, string>): Promise<{ skin: string; slotType: string } | null>
  getVehicleDefaultPaints(vehicleName: string, configName: string): Promise<Array<{ baseColor: number[]; metallic: number; roughness: number; clearcoat: number; clearcoatRoughness: number }>>
  killGame(): Promise<void>
  getGameStatus(): Promise<GameStatus>
  onGameStatusChange(callback: (status: GameStatus) => void): () => void
  joinServer(ip: string, port: number): Promise<{ success: boolean; error?: string }>
  probeServer(ip: string, port: string): Promise<{
    online: boolean; sname?: string; map?: string; players?: string;
    maxplayers?: string; modstotal?: string; playerslist?: string
  }>
  beammpLogin(username: string, password: string): Promise<{ success: boolean; username?: string; error?: string }>
  beammpLoginAsGuest(): Promise<void>
  beammpLogout(): Promise<void>
  getAuthInfo(): Promise<{ authenticated: boolean; username: string; guest: boolean }>
  getLauncherLogs(): Promise<string[]>
  checkBeamMPInstalled(): Promise<boolean>
  installBeamMP(): Promise<{ success: boolean; error?: string }>

  // Support Tools
  openUserFolder(): Promise<{ success: boolean; error?: string }>
  clearCache(): Promise<{ success: boolean; error?: string; freedBytes?: number }>
  clearModCache(): Promise<{ success: boolean; error?: string; freedBytes?: number; fileCount?: number }>
  launchSafeMode(): Promise<{ success: boolean; error?: string }>
  launchSafeVulkan(): Promise<{ success: boolean; error?: string }>
  verifyIntegrity(): Promise<{ success: boolean; error?: string }>

  // Backend
  getServers(): Promise<{ success: boolean; data?: ServerInfo[]; error?: string }>
  login(username: string, password: string): Promise<AuthResult>
  checkBackendHealth(): Promise<boolean>
  setBackendUrl(url: string): Promise<void>
  setAuthUrl(url: string): Promise<void>
  setUseOfficialBackend(useOfficial: boolean): Promise<void>

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

  // Friends
  getFriends(): Promise<Array<{ id: string; displayName: string; addedAt: number; notes?: string; tags?: string[] }>>
  addFriend(id: string, displayName: string): Promise<Array<{ id: string; displayName: string; addedAt: number; notes?: string; tags?: string[] }>>
  removeFriend(id: string): Promise<Array<{ id: string; displayName: string; addedAt: number; notes?: string; tags?: string[] }>>
  updateFriend(id: string, updates: { displayName?: string; notes?: string; tags?: string[] }): Promise<Array<{ id: string; displayName: string; addedAt: number; notes?: string; tags?: string[] }>>
  getFriendSessions(): Promise<Array<{ serverIdent: string; serverName: string; players: string[]; timestamp: number }>>
  recordFriendSession(serverIdent: string, serverName: string, players: string[]): Promise<void>

  // Mods
  getMods(): Promise<{ success: boolean; data?: ModInfo[]; error?: string }>
  repairModIndex(): Promise<{ success: boolean; error?: string }>
  toggleMod(modKey: string, enabled: boolean): Promise<{ success: boolean; error?: string }>
  deleteMod(modKey: string): Promise<{ success: boolean; error?: string }>
  installMod(): Promise<{ success: boolean; data?: ModInfo[]; error?: string }>
  updateModScope(modKey: string, scope: 'client' | 'server' | 'both'): Promise<{ success: boolean; error?: string }>
  updateModType(modKey: string, modType: string): Promise<{ success: boolean; error?: string }>
  openModsFolder(): Promise<void>
  getModPreview(filePath: string): Promise<{ success: boolean; data?: string | null }>

  // Mod Load Order & Conflicts
  getModLoadOrder(): Promise<{ success: boolean; data?: LoadOrderData; error?: string }>
  setModLoadOrder(orderedKeys: string[]): Promise<{ success: boolean; error?: string }>
  toggleLoadOrderEnforcement(enabled: boolean): Promise<{ success: boolean; error?: string }>
  scanModConflicts(): Promise<{ success: boolean; data?: ModConflictReport; error?: string }>
  getModConflicts(modKey: string): Promise<{ success: boolean; data?: { overridden: string[]; wins: string[] }; error?: string }>
  hostedServerGetModLoadOrder(serverId: string): Promise<{ success: boolean; data?: LoadOrderData; error?: string }>
  hostedServerSetModLoadOrder(serverId: string, orderedKeys: string[]): Promise<{ success: boolean; error?: string }>

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
    phase: 'downloading' | 'loading' | 'done' | 'cancelled'
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
  hostedServerGetModGateConfig(id: string): Promise<{ exists: boolean; config: HostedServerModGateConfig | null }>
  hostedServerSaveModGateConfig(id: string, input: { allowedVehicleNames?: string[] }): Promise<{ success: boolean; error?: string }>
  hostedServerListSupportTickets(id: string): Promise<SupportTicket[]>
  hostedServerCreateSupportTicket(id: string, input: SupportTicketCreateInput): Promise<SupportTicket>
  hostedServerUpdateSupportTicket(id: string, ticketId: string, patch: SupportTicketUpdateInput): Promise<SupportTicket | null>
  hostedServerDeleteSupportTicket(id: string, ticketId: string): Promise<boolean>
  hostedServerGetSupportIngestStatus(id: string): Promise<HostedServerSupportIngestStatus>
  hostedServerUpdateSupportIngestConfig(id: string, patch: Partial<HostedServerSupportIngestConfig>): Promise<HostedServerSupportIngestStatus>
  hostedServerStartSupportIngest(id: string): Promise<HostedServerSupportIngestStatus>
  hostedServerStopSupportIngest(id: string): Promise<HostedServerSupportIngestStatus>
  hostedServerGetSupportTicketUiConfig(id: string): Promise<HostedServerSupportTicketUiConfig>
  hostedServerUpdateSupportTicketUiConfig(id: string, patch: Partial<HostedServerSupportTicketUiConfig>): Promise<HostedServerSupportTicketUiConfig>
  hostedServerExportSupportSenderMod(id: string): Promise<{ success: boolean; filePath?: string; error?: string }>
  hostedServerDeploySupportSenderMod(id: string): Promise<{ success: boolean; filePath?: string; error?: string }>
  hostedServerUndeploySupportSenderMod(id: string): Promise<{ success: boolean; error?: string }>
  hostedServerSimulateSupportTicketSubmit(id: string): Promise<{ success: boolean; statusCode?: number; ticketId?: string; error?: string }>
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
  hostedServerRenameFile(id: string, oldPath: string, newName: string): Promise<string>
  hostedServerDuplicateFile(id: string, filePath: string): Promise<string>
  hostedServerZipEntry(id: string, filePath: string): Promise<{ success: boolean; path: string }>
  hostedServerSearchFiles(id: string, subPath: string, query: string): Promise<ServerFileSearchResult[]>
  hostedServerRevealInExplorer(id: string, filePath: string): Promise<void>
  hostedServerOpenEntry(id: string, filePath: string): Promise<void>
  hostedServerDownloadEntry(id: string, filePath: string): Promise<{ success: boolean; canceled?: boolean; path?: string }>
  hostedServerUploadFiles(id: string, destSubPath: string, sourcePaths: string[]): Promise<string[]>
  getPathForFile(file: File): string
  hostedServerTestPort(port: number): Promise<{ open: boolean; ip?: string; error?: string }>
  hostedServerSaveCustomImage(id: string, dataUrl: string): Promise<string>
  hostedServerRemoveCustomImage(id: string): Promise<void>
  hostedServerGetCustomImage(id: string): Promise<string | null>
  hostedServerGetRoutes(id: string): Promise<GPSRoute[]>
  hostedServerSaveRoute(id: string, route: GPSRoute): Promise<GPSRoute[]>
  hostedServerDeleteRoute(id: string, routeId: string): Promise<GPSRoute[]>
  hostedServerGetPlayerPositions(id: string): Promise<PlayerPosition[]>
  hostedServerDeployTracker(id: string): Promise<void>
  hostedServerIsTrackerDeployed(id: string): Promise<boolean>
  hostedServerUndeployTracker(id: string): Promise<void>
  hostedServerDeployVoicePlugin(id: string): Promise<void>
  hostedServerIsVoicePluginDeployed(id: string): Promise<boolean>
  hostedServerUndeployVoicePlugin(id: string): Promise<void>

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
  hostedServerSetIpMeta(id: string, ip: string, patch: { nickname?: string | null; banned?: boolean }): Promise<void>
  hostedServerIsBanPluginDeployed(id: string): Promise<boolean>
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

  // Auto-Updater
  onUpdateAvailable(callback: (info: { version: string; releaseDate: string }) => void): () => void
  onUpdateDownloadProgress(callback: (progress: { percent: number; transferred: number; total: number }) => void): () => void
  onUpdateDownloaded(callback: (info: { version: string }) => void): () => void
  installUpdate(): Promise<void>
  checkForAppUpdate(): Promise<{ ok: boolean; version?: string | null; reason?: string }>

  // Career Save Management
  careerListProfiles(): Promise<Array<{
    name: string
    isRLS: boolean
    path: string
    deployed: boolean
    slots: Array<{
      name: string
      creationDate: string | null
      lastSaved: string | null
      version: number | null
      corrupted: boolean
    }>
  }>>
  careerGetSlotMetadata(profileName: string, slotName: string): Promise<{
    slot: { name: string; creationDate: string | null; lastSaved: string | null; version: number | null; corrupted: boolean }
    level: string | null
    money: number | null
    beamXP: { level: number; value: number; curLvlProgress: number; neededForNext: number } | null
    vehicleCount: number
    vehicles: Array<{ id: string; name: string | null; model: string | null; thumbnailDataUrl: string | null; value: number | null; power: number | null; torque: number | null; weight: number | null; odometer: number | null; insuranceClass: string | null; licensePlate: string | null }>
    isRLS: boolean
    bankBalance: number | null
    creditScore: number | null
    gameplayStats: { totalOdometer: number | null; totalDriftScore: number | null; totalCollisions: number | null }
    insuranceCount: number
    missionCount: number
    totalMissions: number
    skills: Array<{ key: string; value: number; subcategories: Array<{ key: string; value: number }> }>
    reputations: Array<{ name: string; value: number; max: number }>
    stamina: number | null
    vouchers: number | null
    discoveredLocations: number
    unlockedBranches: number
    totalBranches: number
    discoveredBusinesses: string[]
    logbookEntries: number
    favoriteVehicleId: string | null
  } | null>
  careerGetProfileSummary(profileName: string): Promise<{
    money: number | null
    beamXPLevel: number | null
    level: string | null
    vehicleCount: number
    lastSaved: string | null
    totalOdometer: number | null
    missionCount: number
    totalMissions: number
    bankBalance: number | null
    creditScore: number | null
    discoveredLocations: number
    unlockedBranches: number
    discoveredBusinesses: number
    insuranceCount: number
    logbookEntries: number
    lastServer: { serverIdent: string; serverName: string | null; lastPlayed: string } | null
  } | null>
  careerGetLog(profileName: string): Promise<string[]>
  careerDeployProfile(profileName: string): Promise<{ success: boolean; error?: string }>
  careerUndeployProfile(profileName: string): Promise<{ success: boolean; error?: string }>
  careerBackupSlot(profileName: string, slotName: string): Promise<{ success: boolean; backupName?: string; error?: string }>
  careerBackupProfile(profileName: string): Promise<{ success: boolean; backupName?: string; error?: string }>
  careerListProfileBackups(profileName?: string): Promise<Array<{
    name: string
    profileName: string
    slotName: string | null
    timestamp: string
    path: string
  }>>
  careerRestoreProfileBackup(backupName: string): Promise<{ success: boolean; error?: string }>
  careerDeleteProfileBackup(backupName: string): Promise<{ success: boolean; error?: string }>
  careerDeleteProfile(profileName: string, options?: { backup?: boolean }): Promise<{ success: boolean; backupName?: string; error?: string }>
  careerDeleteSlot(profileName: string, slotName: string, options?: { backup?: boolean }): Promise<{ success: boolean; backupName?: string; error?: string }>
  careerSetSavePath(savePath: string | null): Promise<{ success: boolean; error?: string }>
  careerBrowseSavePath(): Promise<string | null>
  careerGetSavePath(): Promise<string | null>
  careerRecordServerAssociation(profileName: string, serverIdent: string, serverName: string | null): Promise<void>
  careerGetServerAssociations(): Promise<Record<string, { serverIdent: string; serverName: string | null; lastPlayed: string }>>

  // Career Mod Management
  careerFetchCareerMPReleases(): Promise<Array<{
    version: string
    name: string
    changelog: string
    prerelease: boolean
    publishedAt: string
    downloadUrl: string
    size: number
    downloads: number
  }>>
  careerFetchRLSReleases(): Promise<Array<{
    version: string
    rlsBaseVersion: string
    name: string
    changelog: string
    prerelease: boolean
    publishedAt: string
    trafficUrl: string | null
    noTrafficUrl: string | null
    trafficSize: number
    noTrafficSize: number
    downloads: number
  }>>
  careerFetchGreatRebalanceRlsReleases(): Promise<Array<{
    version: string
    name: string
    prerelease: boolean
    publishedAt: string
    downloadUrl: string
  }>>
  careerFetchGreatRebalancePatchReleases(): Promise<Array<{
    version: string
    name: string
    prerelease: boolean
    publishedAt: string
    downloadUrl: string
  }>>
  careerInstallCareerMP(downloadUrl: string, version: string, serverDir: string): Promise<{ success: boolean; error?: string }>
  careerInstallRLS(downloadUrl: string, version: string, traffic: boolean, serverDir: string): Promise<{ success: boolean; error?: string }>
  careerInstallRLSGreatRebalance(
    careerMpDownloadUrl: string,
    careerMpVersion: string,
    rlsDownloadUrl: string,
    rlsVersion: string,
    patchDownloadUrl: string,
    patchVersion: string,
    serverDir: string
  ): Promise<{ success: boolean; error?: string }>
  careerGetPythonRuntimeStatus(): Promise<{
    available: boolean
    command?: 'python' | 'py'
    version?: string
    canAutoInstall: boolean
    message?: string
  }>
  careerInstallPythonRuntime(): Promise<{ success: boolean; error?: string }>
  careerGetInstalledMods(serverDir: string): Promise<{
    careerMP: { version: string; installedAt: string } | null
    rls: { version: string; traffic: boolean; installedAt: string } | null
  }>
  careerBrowseServerDir(): Promise<string | null>
  careerGetServerDir(serverId: string): Promise<string>

  // CareerMP server config.json
  careerMPGetServerConfig(serverId: string): Promise<{
    installed: boolean
    exists: boolean
    config: CareerMPServerConfig | null
    raw: string | null
  }>
  careerMPSaveServerConfig(serverId: string, config: CareerMPServerConfig): Promise<{ success: boolean; error?: string }>

  // BeamMP Dynamic Traffic settings.txt
  dynamicTrafficGetConfig(serverId: string): Promise<{
    installed: boolean
    exists: boolean
    config: DynamicTrafficConfig | null
  }>
  dynamicTrafficSaveConfig(serverId: string, config: DynamicTrafficConfig): Promise<{ success: boolean; error?: string }>

  // Career Plugin Browser
  careerListPluginCatalog(): Promise<Array<{
    id: string
    name: string
    description: string
    author: string
    repo: string
    homepage: string
    compat: 'careerMP' | 'rls' | 'both' | 'beamMP'
    installMethod: 'extract-to-root' | 'extract-to-server-plugin' | 'copy-client-zip'
    serverPluginFolder?: string
  }>>
  careerFetchPluginReleases(pluginId: string): Promise<Array<{
    version: string
    name: string
    changelog: string
    prerelease: boolean
    publishedAt: string
    downloadUrl: string
    size: number
    downloads: number
  }>>
  careerInstallPlugin(pluginId: string, version: string, downloadUrl: string, serverDir: string): Promise<{ success: boolean; error?: string }>
  careerUninstallPlugin(pluginId: string, serverDir: string): Promise<{ success: boolean; error?: string }>
  careerGetInstalledPlugins(serverDir: string): Promise<Record<string, { pluginId: string; version: string; installedAt: string; artifacts: string[] }>>

  // Server Admin Tools Plugin Browser
  serverAdminListPluginCatalog(): Promise<Array<{
    id: string
    name: string
    description: string
    author: string
    repo: string
    homepage: string
    compat: 'careerMP' | 'rls' | 'both' | 'beamMP'
    installMethod: 'extract-to-root' | 'extract-to-server-plugin' | 'copy-client-zip'
    serverPluginFolder?: string
  }>>
  serverAdminFetchPluginReleases(pluginId: string): Promise<Array<{
    version: string
    name: string
    changelog: string
    prerelease: boolean
    publishedAt: string
    downloadUrl: string
    size: number
    downloads: number
  }>>
  serverAdminInstallPlugin(pluginId: string, version: string, downloadUrl: string, serverId: string): Promise<{ success: boolean; error?: string }>
  serverAdminUninstallPlugin(pluginId: string, serverId: string): Promise<{ success: boolean; error?: string }>
  serverAdminGetInstalledPlugins(serverId: string): Promise<Record<string, { pluginId: string; version: string; installedAt: string; artifacts: string[] }>>

  // Controls / Input Bindings
  controlsGetDevices(): Promise<import('../shared/types').InputDevice[]>
  controlsGetActions(): Promise<import('../shared/types').InputAction[]>
  controlsGetCategories(): Promise<import('../shared/types').ActionCategory[]>
  controlsGetBindings(deviceFileName: string): Promise<import('../shared/types').MergedDeviceBindings | null>
  controlsSetBinding(deviceFileName: string, binding: import('../shared/types').InputBinding): Promise<import('../shared/types').MergedDeviceBindings>
  controlsRemoveBinding(deviceFileName: string, control: string, action: string): Promise<import('../shared/types').MergedDeviceBindings>
  controlsResetDevice(deviceFileName: string): Promise<void>
  controlsSetFFBConfig(deviceFileName: string, control: string, ffb: import('../shared/types').FFBConfig): Promise<import('../shared/types').MergedDeviceBindings>
  controlsGetSteeringSettings(): Promise<import('../shared/types').SteeringFilterSettings | null>
  controlsSetSteeringSettings(settings: Partial<import('../shared/types').SteeringFilterSettings>): Promise<import('../shared/types').SteeringFilterSettings>
  controlsListPresets(): Promise<import('../shared/types').ControlsPreset[]>
  controlsSavePreset(name: string, deviceFileName: string, device: import('../shared/types').InputDevice): Promise<import('../shared/types').ControlsPreset>
  controlsLoadPreset(presetId: string): Promise<void>
  controlsDeletePreset(presetId: string): Promise<void>
  controlsExportPreset(presetId: string): Promise<import('../shared/types').ControlsPreset>
  controlsImportPreset(jsonString: string): Promise<import('../shared/types').ControlsPreset>

  // GPS Tracker
  gpsDeployTracker(): Promise<{ success: boolean; error?: string }>
  gpsUndeployTracker(): Promise<{ success: boolean; error?: string }>
  gpsIsTrackerDeployed(): Promise<boolean>
  gpsGetTelemetry(): Promise<import('../shared/types').GPSTelemetry | null>
  gpsGetMapPOIs(mapName: string): Promise<import('../shared/types').GPSMapPOI[]>

  // World Editor Sync (Phase 0 spike)
  worldEditDeploy(): Promise<{ success: boolean; error?: string }>
  worldEditUndeploy(): Promise<{ success: boolean; error?: string }>
  worldEditIsDeployed(): Promise<boolean>
  worldEditSignal(
    action:
      | 'start'
      | 'stop'
      | 'replay'
      | 'install'
      | 'uninstall'
      | 'undo'
      | 'redo'
      | 'save'
      | 'saveAs'
      | 'saveProject'
      | 'loadProject',
    payload?: { path?: string }
  ): Promise<{ success: boolean; error?: string }>
  worldEditGetStatus(): Promise<import('../shared/types').EditorSyncStatus | null>
  worldEditReadCapture(tail?: number): Promise<{
    entries: import('../shared/types').EditorSyncCaptureEntry[]
    total: number
  }>
  worldEditListProjects(): Promise<import('../shared/types').EditorProject[]>
  worldEditSaveProject(
    levelName: string,
    projectName: string
  ): Promise<{ success: boolean; error?: string; levelPath?: string }>
  worldEditLoadProject(levelPath: string): Promise<{ success: boolean; error?: string }>
  worldEditDeleteProject(absolutePath: string): Promise<{ success: boolean; error?: string }>

  // World-Editor Session
  worldEditSessionGetStatus(): Promise<import('../shared/types').SessionStatus>
  worldEditSessionHost(opts: {
    port?: number
    token?: string | null
    levelName?: string | null
    displayName?: string
    authMode?: 'open' | 'token' | 'approval' | 'friends'
    friendsWhitelist?: string[]
    advertiseHost?: string | null
    mapModKey?: string | null
  }): Promise<{ success: boolean; error?: string; status?: import('../shared/types').SessionStatus }>
  worldEditSessionJoin(opts: {
    host: string
    port: number
    token?: string | null
    displayName?: string
  }): Promise<{ success: boolean; error?: string; status?: import('../shared/types').SessionStatus }>
  worldEditSessionDecodeCode(code: string): Promise<{
    ok: boolean
    host?: string
    port?: number
    token?: string | null
    level?: string | null
    sessionId?: string | null
    displayName?: string | null
    error?: string
  }>
  worldEditSessionHostAndLaunch(opts: {
    port?: number
    token?: string | null
    levelName?: string | null
    displayName?: string
    authMode?: 'open' | 'token' | 'approval' | 'friends'
    friendsWhitelist?: string[]
    advertiseHost?: string | null
    mapModKey?: string | null
  }): Promise<{ success: boolean; error?: string; status?: import('../shared/types').SessionStatus; level?: string }>
  worldEditSessionJoinCodeAndLaunch(opts: {
    code: string; displayName?: string
  }): Promise<{ success: boolean; error?: string; status?: import('../shared/types').SessionStatus; level?: string }>
  worldEditSessionApprovePeer(authorId: string): Promise<{ success: boolean }>
  worldEditSessionRejectPeer(opts: { authorId: string; reason?: string }): Promise<{ success: boolean }>
  worldEditSessionSetAuthMode(mode: 'open' | 'token' | 'approval' | 'friends'): Promise<{ success: boolean }>
  worldEditSessionSetFriendsWhitelist(usernames: string[]): Promise<{ success: boolean }>
  worldEditSessionSetAdvertiseHost(host: string): Promise<{ success: boolean }>
  worldEditSessionGetHostAddresses(): Promise<Array<{
    kind: 'tailscale' | 'lan' | 'public' | 'loopback'
    address: string
    label: string
    recommended: boolean
  }>>
  worldEditSessionLeave(): Promise<{ success: boolean }>
  /** §D undo/redo. ok:false + reason='empty-stack'|'unsupported'|'no-session'. */
  worldEditSessionUndo(): Promise<{ ok: boolean; reason?: string; name?: string }>
  worldEditSessionRedo(): Promise<{ ok: boolean; reason?: string; name?: string }>
  worldEditSessionUndoDepths(): Promise<{ undo: number; redo: number }>

  /* §E world save / load / convert */
  worldSaveSave(opts?: {
    destPath?: string
    title?: string
    description?: string
    includeOpLog?: boolean
    previewPngPath?: string
    forceBuildSnapshot?: boolean
  }): Promise<
    | { success: true; path: string; bytes: number; title: string }
    | { success: false; cancelled?: true; error?: string }
  >
  worldSaveInspect(sourcePath?: string): Promise<
    | { success: true; manifest: unknown; compressedBytes: number; uncompressedBytes: number; entryCount: number }
    | { success: false; cancelled?: true; error?: string }
  >
  worldSaveLoad(opts?: { sourcePath?: string }): Promise<
    | { success: true; levelName: string; worldId: string; stagedModsPath: string | null; modCount: number; hasSnapshot: boolean; opLogCount: number; seededIntoRelay: boolean }
    | { success: false; cancelled?: true; error?: string }
  >
  worldSaveConvertProjectToWorld(opts: {
    sourceProjectZip?: string
    destPath?: string
    levelName: string
    title?: string
    description?: string
    authorId: string
    authorDisplayName: string
    beamngBuild?: string
  }): Promise<
    | { success: true; path: string; bytes: number }
    | { success: false; cancelled?: true; error?: string }
  >
  worldSaveConvertWorldToProject(opts?: {
    sourceWorld?: string
    destProjectZip?: string
  }): Promise<
    | { success: true; path: string; bytes: number }
    | { success: false; cancelled?: true; error?: string }
  >
  worldEditSessionLaunchIntoEditor(opts?: {
    levelOverride?: string | null
  }): Promise<{ success: boolean; error?: string; level?: string }>
  worldEditSessionGetLanIps(): Promise<string[]>
  worldEditSessionGetPublicIp(): Promise<{ ip: string | null; error?: string }>
  worldEditSessionCheckFirewallHole(port: number): Promise<{
    supported: boolean
    exists?: boolean
    error?: string
  }>
  worldEditSessionOpenFirewallHole(port: number): Promise<{
    success: boolean
    cancelled?: boolean
    error?: string
  }>
  worldEditSessionTestReachability(host: string, port: number): Promise<{
    success: boolean
    latencyMs?: number
    error?: string
  }>
  onWorldEditSessionStatus(cb: (status: import('../shared/types').SessionStatus) => void): () => void
  onWorldEditSessionOp(cb: (op: import('../shared/types').SessionOp) => void): () => void
  onWorldEditSessionLog(cb: (entry: import('../shared/types').SessionLogEntry) => void): () => void
  onWorldEditSessionPeerPose(cb: (pose: import('../shared/types').PeerPoseEntry) => void): () => void
  onWorldEditSessionPeerActivity(cb: (act: import('../shared/types').PeerActivity) => void): () => void
  onWorldEditSessionPeerPendingApproval(cb: (p: {
    authorId: string; displayName: string; beamUsername: string | null; remote: string
  }) => void): () => void
  onWorldEditSessionLevelRequired(cb: (info: {
    levelName: string | null
    levelSource: { builtIn: boolean; modPath?: string; hash?: string } | null
  }) => void): () => void

  /* Coop-session project: advertise (host) / download (joiner). */
  worldEditSessionSetActiveProject(args: {
    path: string; name: string; levelName: string; folder: string
  }): Promise<{
    success: boolean
    error?: string
    project?: import('../shared/types').SessionProjectInfo | null
  }>
  worldEditSessionClearActiveProject(): Promise<{ success: boolean }>
  worldEditSessionDownloadOfferedProject(): Promise<{
    success: boolean
    error?: string
    localPath?: string
  }>
  onWorldEditSessionProjectOffered(cb: (info: import('../shared/types').SessionProjectInfo) => void): () => void

  // Voice Chat
  voiceEnable(): Promise<{ success: boolean; error?: string }>
  voiceDisable(): Promise<{ success: boolean; error?: string }>
  voiceSendSignal(data: string): Promise<void>
  voiceSendAudio(payload: { seq: number; data: string }): Promise<void>
  voiceGetState(): Promise<import('../shared/types').VoiceChatState>
  voiceUpdateSettings(settings: import('../shared/types').VoiceChatSettings): Promise<void>
  voiceDeployBridge(): Promise<{ success: boolean; error?: string }>
  voiceUndeployBridge(): Promise<{ success: boolean; error?: string }>
  onVoicePeerJoined(callback: (data: { playerId: number; playerName: string; polite?: boolean }) => void): () => void
  onVoicePeerLeft(callback: (data: { playerId: number }) => void): () => void
  onVoiceSignal(callback: (data: { fromId: number; payload: string }) => void): () => void
  onVoiceAudio(callback: (data: { fromId: number; seq: number; data: string }) => void): () => void
  onVoiceRelayState(callback: (data: { inRelay: boolean }) => void): () => void
  onVoiceSelfId(callback: (data: { selfId: number }) => void): () => void

  // Voice mesh tier
  voiceMeshListen(): Promise<{ port: number }>
  voiceMeshStop(): Promise<{ success: boolean }>
  voiceMeshConnect(payload: { peerId: string; host: string; port: number; selfPeerId: string }): Promise<{ success: boolean; error?: string }>
  voiceMeshDisconnect(peerId: string): Promise<{ success: boolean }>
  voiceMeshSend(payload: { peerId: string; data: Uint8Array }): Promise<boolean>
  onVoiceMeshData(callback: (data: { peerId: string; data: Uint8Array }) => void): () => void
  onVoiceMeshState(callback: (data: { peerId: string; state: 'connecting' | 'open' | 'closed' | 'error'; reason?: string }) => void): () => void

  // Livery Editor
  liveryGetUVTemplate(vehicleName: string): Promise<{ template: string | null; width: number; height: number }>
  liveryGetSkinMaterials(vehicleName: string): Promise<Array<{ materialName: string; texturePath: string; uvChannel: 0 | 1; hasPaletteMap: boolean }>>
  liveryExportSkinMod(params: import('../shared/types').LiveryExportParams): Promise<{ success: boolean; filePath?: string; error?: string }>
  liverySaveProject(data: string): Promise<{ success: boolean; filePath?: string; error?: string }>
  liveryLoadProject(): Promise<{ success: boolean; data?: string; error?: string }>
  liveryImportImage(): Promise<string | null>

  // Lua Console (live BeamNG.drive GE-Lua REPL)
  luaConsoleDeploy(): Promise<{ success: boolean; error?: string; port?: number }>
  luaConsoleUndeploy(): Promise<{ success: boolean; error?: string }>
  luaConsoleIsDeployed(): Promise<boolean>
  luaConsoleIsConnected(): Promise<boolean>
  luaConsoleExecute(payload: { reqId: number; source: string }): Promise<{ success: boolean }>
  luaConsoleInspect(payload: { reqId: number; path: string }): Promise<{ success: boolean }>
  luaConsoleSetScope(payload: { scope: 'ge' | 'veh'; vehId?: number | null }): Promise<{ success: boolean }>
  luaConsoleClear(): Promise<{ success: boolean }>
  luaConsoleComplete(payload: { reqId: number; prefix: string }): Promise<{ success: boolean }>
  luaConsoleTree(payload: { reqId: number; path: string }): Promise<{ success: boolean }>
  luaConsoleQuery(payload: { reqId: number; query: string }): Promise<{ success: boolean }>
  luaConsoleReload(payload: { reqId: number | null; action: 'ge' | 'veh' | 'env' }): Promise<{ success: boolean }>
  // ── BeamNG UI Files ──
  beamUIListRoots(payload: { includeInstall: boolean; installWritable?: boolean }): Promise<{ roots: Array<{ id: string; label: string; path: string; kind: 'userUi' | 'modUi' | 'installUi'; writable: boolean; modName?: string }>; resolvedUserDir: string | null; resolvedInstallDir: string | null }>
  beamUIListDir(payload: { rootId: string; subPath: string }): Promise<Array<{ name: string; isDirectory: boolean; size: number; modifiedMs: number }>>
  beamUIReadFile(payload: { rootId: string; subPath: string }): Promise<string>
  beamUIReadFileSmart(payload: { rootId: string; subPath: string; maxBytes?: number }): Promise<{ kind: 'text' | 'binary'; content: string; size: number; truncated: boolean }>
  beamUIReadBinaryDataUrl(payload: { rootId: string; subPath: string; mime: string; maxBytes?: number }): Promise<{ dataUrl: string; size: number; truncated: boolean }>
  beamUIWriteFile(payload: { rootId: string; subPath: string; content: string }): Promise<{ success: boolean }>
  beamUICreateFolder(payload: { rootId: string; subPath: string }): Promise<{ success: boolean }>
  beamUIDelete(payload: { rootId: string; subPath: string }): Promise<{ success: boolean }>
  beamUIRename(payload: { rootId: string; subPath: string; newName: string }): Promise<string>
  beamUIRevealInExplorer(payload: { rootId: string; subPath: string }): Promise<{ success: boolean }>
  beamUIListStaged(): Promise<Array<{ rootId: string; subPath: string; originalExisted: boolean; backupName: string; savedAt: number; saveCount: number }>>
  beamUICommit(payload: { rootId: string; subPath: string }): Promise<{ success: boolean }>
  beamUICommitAll(): Promise<{ committed: number }>
  beamUIRevert(payload: { rootId: string; subPath: string }): Promise<{ success: boolean }>
  beamUIRevertAll(): Promise<{ reverted: number }>
  beamUIGetAutoRevert(): Promise<boolean>
  beamUISetAutoRevert(payload: { value: boolean }): Promise<{ success: boolean }>
  beamUIListProjects(): Promise<Array<{ name: string; savedAt: number; fileCount: number }>>
  beamUISaveProject(payload: { name: string }): Promise<{ savedAt: number; fileCount: number }>
  beamUILoadProject(payload: { name: string }): Promise<{ applied: number; skipped: string[] }>
  beamUIDeleteProject(payload: { name: string }): Promise<{ success: boolean }>
  onBeamUIStagingChanged(callback: (data: { reason: string; reverted?: number }) => void): () => void
  onLuaConsoleResult(callback: (data: { reqId: number; status: 'ok' | 'err'; repr: string }) => void): () => void
  onLuaConsoleLog(callback: (data: { kind: 'log' | 'print'; level?: 'I' | 'W' | 'E' | 'D'; source?: string; text: string; at: number }) => void): () => void
  onLuaConsoleConnection(callback: (data: { connected: boolean }) => void): () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
