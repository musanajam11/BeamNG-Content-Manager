import { ElectronAPI } from '@electron-toolkit/preload'
import type { AppConfig, GamePaths, ServerInfo, AuthResult, GameStatus, ModInfo, RepoBrowseResult, RepoCategory, RepoSortOrder, VehicleDetail, VehicleConfigInfo, VehicleConfigData, HostedServerConfig, HostedServerStatus, HostedServerEntry, ServerFileEntry, ServerExeStatus, GPSRoute, PlayerPosition, BackupSchedule, BackupEntry, ScheduledTask, AnalyticsData, MapRichMetadata, LoadOrderData, ModConflictReport } from '../shared/types'
import type { RegistryStatus, RegistrySearchOptions, RegistrySearchResult, AvailableMod, InstalledRegistryMod, ResolutionResult, RegistryRepository, BeamModMetadata, ModpackExport } from '../shared/registry-types'

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
  listMaps(): Promise<{ name: string; source: 'stock' | 'mod'; modZipPath?: string; levelDir?: string }[]>
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
  careerInstallCareerMP(downloadUrl: string, version: string, serverDir: string): Promise<{ success: boolean; error?: string }>
  careerInstallRLS(downloadUrl: string, version: string, traffic: boolean, serverDir: string): Promise<{ success: boolean; error?: string }>
  careerGetInstalledMods(serverDir: string): Promise<{
    careerMP: { version: string; installedAt: string } | null
    rls: { version: string; traffic: boolean; installedAt: string } | null
  }>
  careerBrowseServerDir(): Promise<string | null>
  careerGetServerDir(serverId: string): Promise<string>

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
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
