import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateConfig: (partial: Record<string, unknown>) => ipcRenderer.invoke('config:update', partial),
  markSetupComplete: () => ipcRenderer.invoke('config:markSetupComplete'),
  browseServerExe: () =>
    ipcRenderer.invoke('config:browseServerExe') as Promise<string | null>,

  // Appearance
  setZoomFactor: (factor: number) => ipcRenderer.invoke('appearance:setZoom', factor),
  getZoomFactor: () => ipcRenderer.invoke('appearance:getZoom') as Promise<number>,
  pickBackgroundImage: () => ipcRenderer.invoke('appearance:pickBackgroundImage') as Promise<string | null>,
  loadBackgroundImage: (filePath: string) =>
    ipcRenderer.invoke('appearance:loadBackgroundImage', filePath) as Promise<string | null>,
  getDefaultBackgrounds: () =>
    ipcRenderer.invoke('appearance:getDefaultBackgrounds') as Promise<string[]>,
  deleteDefaultBackground: (filePath: string) =>
    ipcRenderer.invoke('appearance:deleteDefaultBackground', filePath) as Promise<boolean>,
  loadBackgroundThumb: (filePath: string) =>
    ipcRenderer.invoke('appearance:loadBackgroundThumb', filePath) as Promise<string | null>,

  // Versions
  getVersions: () => ipcRenderer.invoke('app:getVersions') as Promise<{ appVersion: string; gameVersion: string | null; launcherVersion: string; serverVersion: string | null }>,

  // Game Discovery
  discoverPaths: () => ipcRenderer.invoke('game:discoverPaths'),
  validatePaths: (paths: Record<string, unknown>) => ipcRenderer.invoke('game:validatePaths', paths),
  setCustomPaths: (installDir: string, userDir: string) =>
    ipcRenderer.invoke('game:setCustomPaths', installDir, userDir),

  // Game Launcher
  launchGame: () => ipcRenderer.invoke('game:launch'),
  launchVanilla: (config?: { mode?: string; level?: string; vehicle?: string }) =>
    ipcRenderer.invoke('game:launchVanilla', config),
  listMaps: () =>
    ipcRenderer.invoke('game:listMaps') as Promise<{ name: string; source: 'stock' | 'mod'; modZipPath?: string; levelDir?: string }[]>,
  listVehicles: () =>
    ipcRenderer.invoke('game:listVehicles'),
  getVehiclePreview: (vehicleName: string) =>
    ipcRenderer.invoke('game:getVehiclePreview', vehicleName) as Promise<string | null>,
  getVehicleDetail: (vehicleName: string) =>
    ipcRenderer.invoke('game:getVehicleDetail', vehicleName),
  getVehicleConfigs: (vehicleName: string) =>
    ipcRenderer.invoke('game:getVehicleConfigs', vehicleName),
  getVehicleConfigPreview: (vehicleName: string, configName: string) =>
    ipcRenderer.invoke('game:getVehicleConfigPreview', vehicleName, configName) as Promise<string | null>,
  getVehicleConfigData: (vehicleName: string, configName: string) =>
    ipcRenderer.invoke('game:getVehicleConfigData', vehicleName, configName),
  saveVehicleConfig: (vehicleName: string, configName: string, data: Record<string, unknown>) =>
    ipcRenderer.invoke('game:saveVehicleConfig', vehicleName, configName, data),
  deleteVehicleConfig: (vehicleName: string, configName: string) =>
    ipcRenderer.invoke('game:deleteVehicleConfig', vehicleName, configName),
  renameVehicleConfig: (vehicleName: string, oldName: string, newName: string) =>
    ipcRenderer.invoke('game:renameVehicleConfig', vehicleName, oldName, newName),
  getVehicle3DModel: (vehicleName: string, activeMeshes?: string[]) =>
    ipcRenderer.invoke('game:getVehicle3DModel', vehicleName, activeMeshes) as Promise<string[]>,
  getActiveVehicleMeshes: (vehicleName: string, configParts: Record<string, string>) =>
    ipcRenderer.invoke('game:getActiveVehicleMeshes', vehicleName, configParts) as Promise<{ meshes: string[]; meshOwnership: Record<string, string> }>,
  getWheelPlacements: (vehicleName: string, configParts: Record<string, string>) =>
    ipcRenderer.invoke('game:getWheelPlacements', vehicleName, configParts) as Promise<Array<{ meshName: string; position: [number, number, number]; group: string; corner: string }>>,
  getVehicleEditorData: (vehicleName: string) =>
    ipcRenderer.invoke('game:getVehicleEditorData', vehicleName),
  getVehicleMaterials: (vehicleName: string) =>
    ipcRenderer.invoke('game:getVehicleMaterials', vehicleName) as Promise<Record<string, unknown>>,
  getActiveGlobalSkin: (vehicleName: string, configParts: Record<string, string>) =>
    ipcRenderer.invoke('game:getActiveGlobalSkin', vehicleName, configParts) as Promise<{ skin: string; slotType: string } | null>,
  getVehicleDefaultPaints: (vehicleName: string, configName: string) =>
    ipcRenderer.invoke('game:getVehicleDefaultPaints', vehicleName, configName) as Promise<Array<{ baseColor: number[]; metallic: number; roughness: number; clearcoat: number; clearcoatRoughness: number }>>,
  killGame: () => ipcRenderer.invoke('game:kill'),
  getGameStatus: () => ipcRenderer.invoke('game:status'),
  onGameStatusChange: (
    callback: (status: { running: boolean; pid: number | null; connectedServer: string | null }) => void
  ) => {
    const handler = (
      _event: unknown,
      status: { running: boolean; pid: number | null; connectedServer: string | null }
    ): void => callback(status)
    ipcRenderer.on('game:statusChange', handler)
    return () => ipcRenderer.removeListener('game:statusChange', handler)
  },
  joinServer: (ip: string, port: number) => ipcRenderer.invoke('game:joinServer', ip, port),
  probeServer: (ip: string, port: string) =>
    ipcRenderer.invoke('game:probeServer', ip, port) as Promise<{
      online: boolean; sname?: string; map?: string; players?: string;
      maxplayers?: string; modstotal?: string; playerslist?: string
    }>,
  beammpLogin: (username: string, password: string) => ipcRenderer.invoke('game:beammpLogin', username, password),
  beammpLoginAsGuest: () => ipcRenderer.invoke('game:beammpLoginAsGuest'),
  beammpLogout: () => ipcRenderer.invoke('game:beammpLogout'),
  getAuthInfo: () => ipcRenderer.invoke('game:getAuthInfo'),
  getLauncherLogs: () => ipcRenderer.invoke('game:getLauncherLogs'),

  // Discord Rich Presence
  discordSetPage: (pageId: string) => ipcRenderer.send('discord:setPage', pageId),
  discordSetPlaying: (info: {
    serverName: string
    mapName: string
    carName?: string
    tags?: string
    playerCount?: number
    maxPlayers?: number
  }) => ipcRenderer.send('discord:setPlaying', info),
  discordClearPlaying: () => ipcRenderer.send('discord:clearPlaying'),

  // Support Tools
  openUserFolder: () => ipcRenderer.invoke('game:openUserFolder') as Promise<{ success: boolean; error?: string }>,
  clearCache: () => ipcRenderer.invoke('game:clearCache') as Promise<{ success: boolean; error?: string; freedBytes?: number }>,
  launchSafeMode: () => ipcRenderer.invoke('game:launchSafeMode') as Promise<{ success: boolean; error?: string }>,
  launchSafeVulkan: () => ipcRenderer.invoke('game:launchSafeVulkan') as Promise<{ success: boolean; error?: string }>,
  verifyIntegrity: () => ipcRenderer.invoke('game:verifyIntegrity') as Promise<{ success: boolean; error?: string }>,

  // Backend
  getServers: () => ipcRenderer.invoke('backend:getServers'),
  login: (username: string, password: string) =>
    ipcRenderer.invoke('backend:login', username, password),
  checkBackendHealth: () => ipcRenderer.invoke('backend:checkHealth'),
  setBackendUrl: (url: string) => ipcRenderer.invoke('backend:setUrl', url),
  setAuthUrl: (url: string) => ipcRenderer.invoke('backend:setAuthUrl', url),
  setUseOfficialBackend: (useOfficial: boolean) => ipcRenderer.invoke('backend:setUseOfficial', useOfficial),

  // Map Preview
  getMapPreview: (mapPath: string, modZipPath?: string) =>
    ipcRenderer.invoke('map:getPreview', mapPath, modZipPath) as Promise<string | null>,

  // Map Minimap (top-down overhead image)
  getMapMinimap: (mapPath: string) =>
    ipcRenderer.invoke('map:getMinimap', mapPath) as Promise<{ dataUrl: string; worldBounds?: { minX: number; maxX: number; minY: number; maxY: number } } | null>,

  // Map Terrain Base
  getMapTerrainBase: (mapPath: string, modZipPath?: string) =>
    ipcRenderer.invoke('map:getTerrainBase', mapPath, modZipPath) as Promise<string | null>,

  // Map Heightmap
  getMapHeightmap: (mapPath: string) =>
    ipcRenderer.invoke('map:getHeightmap', mapPath) as Promise<string | null>,

  // Map Terrain Info
  getMapTerrainInfo: (mapPath: string) =>
    ipcRenderer.invoke('map:getTerrainInfo', mapPath) as Promise<{ size: number } | null>,

  // Map Rich Metadata (info.json + .terrain.json + mod registry)
  getMapMetadata: (mapName: string, modZipPath?: string) =>
    ipcRenderer.invoke('map:getMetadata', mapName, modZipPath) as Promise<import('../shared/types').MapRichMetadata>,

  // Map Road Route (A* pathfinding along roads)
  findMapRoute: (mapPath: string, startX: number, startY: number, endX: number, endY: number) =>
    ipcRenderer.invoke('map:findRoute', mapPath, startX, startY, endX, endY) as Promise<{ x: number; y: number }[]>,

  // Flag Images (cached)
  getFlags: (codes: string[]) =>
    ipcRenderer.invoke('flags:batch', codes) as Promise<Record<string, string>>,

  // Favorites
  getFavorites: () => ipcRenderer.invoke('favorites:get') as Promise<string[]>,
  setFavorite: (ident: string, favorite: boolean) =>
    ipcRenderer.invoke('favorites:set', ident, favorite) as Promise<string[]>,

  // Recent Servers
  getRecentServers: () =>
    ipcRenderer.invoke('recentServers:get') as Promise<Array<{ ident: string; timestamp: number }>>,

  // Friends
  getFriends: () =>
    ipcRenderer.invoke('friends:getAll') as Promise<Array<{ id: string; displayName: string; addedAt: number; notes?: string; tags?: string[] }>>,
  addFriend: (id: string, displayName: string) =>
    ipcRenderer.invoke('friends:add', id, displayName) as Promise<Array<{ id: string; displayName: string; addedAt: number; notes?: string; tags?: string[] }>>,
  removeFriend: (id: string) =>
    ipcRenderer.invoke('friends:remove', id) as Promise<Array<{ id: string; displayName: string; addedAt: number; notes?: string; tags?: string[] }>>,
  updateFriend: (id: string, updates: { displayName?: string; notes?: string; tags?: string[] }) =>
    ipcRenderer.invoke('friends:update', id, updates) as Promise<Array<{ id: string; displayName: string; addedAt: number; notes?: string; tags?: string[] }>>,
  getFriendSessions: () =>
    ipcRenderer.invoke('friends:getSessions') as Promise<Array<{ serverIdent: string; serverName: string; players: string[]; timestamp: number }>>,
  recordFriendSession: (serverIdent: string, serverName: string, players: string[]) =>
    ipcRenderer.invoke('friends:recordSession', serverIdent, serverName, players) as Promise<void>,

  // Mods
  getMods: () => ipcRenderer.invoke('mods:list'),
  toggleMod: (modKey: string, enabled: boolean) => ipcRenderer.invoke('mods:toggle', modKey, enabled),
  deleteMod: (modKey: string) => ipcRenderer.invoke('mods:delete', modKey),
  installMod: () => ipcRenderer.invoke('mods:install'),
  updateModScope: (modKey: string, scope: 'client' | 'server' | 'both') => ipcRenderer.invoke('mods:updateScope', modKey, scope),
  updateModType: (modKey: string, modType: string) => ipcRenderer.invoke('mods:updateType', modKey, modType),
  openModsFolder: () => ipcRenderer.invoke('mods:openFolder'),
  getModPreview: (filePath: string) => ipcRenderer.invoke('mods:preview', filePath),

  // Mod Load Order
  getModLoadOrder: () => ipcRenderer.invoke('mods:getLoadOrder'),
  setModLoadOrder: (orderedKeys: string[]) => ipcRenderer.invoke('mods:setLoadOrder', orderedKeys),
  toggleLoadOrderEnforcement: (enabled: boolean) => ipcRenderer.invoke('mods:toggleEnforcement', enabled),

  // Mod Conflict Detection
  scanModConflicts: () =>
    ipcRenderer.invoke('mods:scanConflicts') as Promise<{ success: boolean; data?: import('../shared/types').ModConflictReport; error?: string }>,
  getModConflicts: (modKey: string) =>
    ipcRenderer.invoke('mods:getModConflicts', modKey) as Promise<{ success: boolean; data?: import('../shared/types').ModConflict[]; error?: string }>,

  // Mod Repository
  browseRepoMods: (categoryId: number, page: number, sort: string) =>
    ipcRenderer.invoke('repo:browse', categoryId, page, sort),
  searchRepoMods: (query: string, page: number) =>
    ipcRenderer.invoke('repo:search', query, page),
  getRepoCategories: () => ipcRenderer.invoke('repo:categories'),
  openModPage: (url: string) => ipcRenderer.invoke('repo:openPage', url),
  downloadRepoMod: (resourceId: number, slug: string) =>
    ipcRenderer.invoke('repo:download', resourceId, slug) as Promise<{
      success: boolean
      fileName?: string
      error?: string
    }>,
  onRepoDownloadProgress: (
    callback: (progress: { received: number; total: number; fileName: string }) => void
  ) => {
    const handler = (
      _event: unknown,
      progress: { received: number; total: number; fileName: string }
    ): void => callback(progress)
    ipcRenderer.on('repo:download-progress', handler)
    return () => ipcRenderer.removeListener('repo:download-progress', handler)
  },
  getRepoThumbnails: (urls: string[]) =>
    ipcRenderer.invoke('repo:thumbnails', urls) as Promise<Record<string, string>>,
  beamngWebLogin: () =>
    ipcRenderer.invoke('repo:beamngLogin') as Promise<{ success: boolean }>,
  beamngWebLoggedIn: () =>
    ipcRenderer.invoke('repo:beamngLoggedIn') as Promise<{ loggedIn: boolean; username: string }>,
  beamngWebLogout: () =>
    ipcRenderer.invoke('repo:beamngLogout') as Promise<void>,

  // Window Controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    const handler = (_event: unknown, maximized: boolean): void => callback(maximized)
    ipcRenderer.on('window:maximized-changed', handler)
    return () => ipcRenderer.removeListener('window:maximized-changed', handler)
  },

  // Server Queue (Wait-to-Join)
  queueStart: (ip: string, port: string, sname: string) =>
    ipcRenderer.invoke('queue:start', ip, port, sname),
  queueStop: () => ipcRenderer.invoke('queue:stop'),
  queueGetStatus: () => ipcRenderer.invoke('queue:status'),
  onQueueStatus: (callback: (status: Record<string, unknown>) => void) => {
    const handler = (_event: unknown, status: Record<string, unknown>): void => callback(status)
    ipcRenderer.on('queue:status', handler)
    return () => ipcRenderer.removeListener('queue:status', handler)
  },
  onQueueJoined: (callback: (result: Record<string, unknown>) => void) => {
    const handler = (_event: unknown, result: Record<string, unknown>): void => callback(result)
    ipcRenderer.on('queue:joined', handler)
    return () => ipcRenderer.removeListener('queue:joined', handler)
  },
  onModSyncProgress: (
    callback: (progress: { phase: string; modIndex: number; modCount: number; fileName: string; received: number; total: number }) => void
  ) => {
    const handler = (
      _event: unknown,
      progress: { phase: string; modIndex: number; modCount: number; fileName: string; received: number; total: number }
    ): void => callback(progress)
    ipcRenderer.on('game:modSyncProgress', handler)
    return () => ipcRenderer.removeListener('game:modSyncProgress', handler)
  },

  // Hosted Server Manager
  hostedServerList: () => ipcRenderer.invoke('hostedServer:list'),
  hostedServerCreate: (partial?: Record<string, unknown>) =>
    ipcRenderer.invoke('hostedServer:create', partial),
  hostedServerUpdate: (id: string, partial: Record<string, unknown>) =>
    ipcRenderer.invoke('hostedServer:update', id, partial),
  hostedServerDelete: (id: string) => ipcRenderer.invoke('hostedServer:delete', id),
  hostedServerStart: (id: string) => ipcRenderer.invoke('hostedServer:start', id),
  hostedServerStop: (id: string) => ipcRenderer.invoke('hostedServer:stop', id),
  hostedServerRestart: (id: string) => ipcRenderer.invoke('hostedServer:restart', id),
  hostedServerGetConsole: (id: string) =>
    ipcRenderer.invoke('hostedServer:getConsole', id) as Promise<string[]>,
  hostedServerSendCommand: (id: string, command: string) =>
    ipcRenderer.invoke('hostedServer:sendCommand', id, command),
  hostedServerGetExeStatus: () =>
    ipcRenderer.invoke('hostedServer:getExeStatus') as Promise<string>,
  hostedServerDownloadExe: () =>
    ipcRenderer.invoke('hostedServer:downloadExe') as Promise<{ success: boolean; error?: string }>,
  hostedServerInstallExe: (sourcePath: string) =>
    ipcRenderer.invoke('hostedServer:installExe', sourcePath) as Promise<string>,
  hostedServerBrowseExe: () =>
    ipcRenderer.invoke('hostedServer:browseExe') as Promise<string | null>,
  hostedServerListFiles: (id: string, subPath?: string) =>
    ipcRenderer.invoke('hostedServer:listFiles', id, subPath),
  hostedServerDeployedMods: (id: string) =>
    ipcRenderer.invoke('hostedServer:deployedMods', id) as Promise<string[]>,
  hostedServerUndeployMod: (id: string, modFileName: string) =>
    ipcRenderer.invoke('hostedServer:undeployMod', id, modFileName) as Promise<void>,
  hostedServerGetServersWithMod: (modFileName: string) =>
    ipcRenderer.invoke('hostedServer:getServersWithMod', modFileName) as Promise<
      Array<{ id: string; name: string }>
    >,
  hostedServerDeleteFile: (id: string, filePath: string) =>
    ipcRenderer.invoke('hostedServer:deleteFile', id, filePath),
  hostedServerCreateFolder: (id: string, folderPath: string) =>
    ipcRenderer.invoke('hostedServer:createFolder', id, folderPath),
  hostedServerCopyMod: (id: string, modFilePath: string) =>
    ipcRenderer.invoke('hostedServer:copyMod', id, modFilePath),
  hostedServerAddFiles: (id: string, destSubPath: string) =>
    ipcRenderer.invoke('hostedServer:addFiles', id, destSubPath) as Promise<string[]>,
  hostedServerReadFile: (id: string, filePath: string) =>
    ipcRenderer.invoke('hostedServer:readFile', id, filePath) as Promise<string>,
  hostedServerWriteFile: (id: string, filePath: string, content: string) =>
    ipcRenderer.invoke('hostedServer:writeFile', id, filePath, content) as Promise<void>,
  hostedServerExtractZip: (id: string, zipPath: string) =>
    ipcRenderer.invoke('hostedServer:extractZip', id, zipPath) as Promise<{ success: boolean; extracted: number }>,
  hostedServerTestPort: (port: number) =>
    ipcRenderer.invoke('hostedServer:testPort', port) as Promise<{ open: boolean; ip?: string; error?: string }>,
  hostedServerSaveCustomImage: (id: string, dataUrl: string) =>
    ipcRenderer.invoke('hostedServer:saveCustomImage', id, dataUrl) as Promise<string>,
  hostedServerRemoveCustomImage: (id: string) =>
    ipcRenderer.invoke('hostedServer:removeCustomImage', id) as Promise<void>,
  hostedServerGetCustomImage: (id: string) =>
    ipcRenderer.invoke('hostedServer:getCustomImage', id) as Promise<string | null>,
  hostedServerGetRoutes: (id: string) =>
    ipcRenderer.invoke('hostedServer:getRoutes', id),
  hostedServerSaveRoute: (id: string, route: Record<string, unknown>) =>
    ipcRenderer.invoke('hostedServer:saveRoute', id, route),
  hostedServerDeleteRoute: (id: string, routeId: string) =>
    ipcRenderer.invoke('hostedServer:deleteRoute', id, routeId),
  hostedServerGetPlayerPositions: (id: string) =>
    ipcRenderer.invoke('hostedServer:getPlayerPositions', id),
  hostedServerDeployTracker: (id: string) =>
    ipcRenderer.invoke('hostedServer:deployTracker', id),
  hostedServerIsTrackerDeployed: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('hostedServer:isTrackerDeployed', id),
  hostedServerUndeployTracker: (id: string) =>
    ipcRenderer.invoke('hostedServer:undeployTracker', id),
  hostedServerDeployVoicePlugin: (id: string) =>
    ipcRenderer.invoke('hostedServer:deployVoicePlugin', id),
  hostedServerIsVoicePluginDeployed: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('hostedServer:isVoicePluginDeployed', id),
  hostedServerUndeployVoicePlugin: (id: string) =>
    ipcRenderer.invoke('hostedServer:undeployVoicePlugin', id),
  hostedServerGetModLoadOrder: (id: string) =>
    ipcRenderer.invoke('hostedServer:getModLoadOrder', id),
  hostedServerSetModLoadOrder: (id: string, orderedKeys: string[]) =>
    ipcRenderer.invoke('hostedServer:setModLoadOrder', id, orderedKeys),

  // Backup Schedule
  hostedServerGetSchedule: (id: string) =>
    ipcRenderer.invoke('hostedServer:getSchedule', id),
  hostedServerSaveSchedule: (id: string, schedule: Record<string, unknown>) =>
    ipcRenderer.invoke('hostedServer:saveSchedule', id, schedule),
  hostedServerCreateBackup: (id: string) =>
    ipcRenderer.invoke('hostedServer:createBackup', id),
  hostedServerListBackups: (id: string) =>
    ipcRenderer.invoke('hostedServer:listBackups', id),
  hostedServerDeleteBackup: (id: string, filename: string) =>
    ipcRenderer.invoke('hostedServer:deleteBackup', id, filename),
  hostedServerRestoreBackup: (id: string, filename: string) =>
    ipcRenderer.invoke('hostedServer:restoreBackup', id, filename),

  // Scheduled Tasks
  hostedServerGetTasks: (id: string) =>
    ipcRenderer.invoke('hostedServer:getTasks', id),
  hostedServerSaveTask: (id: string, task: Record<string, unknown>) =>
    ipcRenderer.invoke('hostedServer:saveTask', id, task),
  hostedServerCreateTask: (id: string, task: Record<string, unknown>) =>
    ipcRenderer.invoke('hostedServer:createTask', id, task),
  hostedServerDeleteTask: (id: string, taskId: string) =>
    ipcRenderer.invoke('hostedServer:deleteTask', id, taskId),
  hostedServerRunTaskNow: (id: string, taskId: string) =>
    ipcRenderer.invoke('hostedServer:runTaskNow', id, taskId),

  // Analytics
  hostedServerGetAnalytics: (id: string) =>
    ipcRenderer.invoke('hostedServer:getAnalytics', id),
  hostedServerClearAnalytics: (id: string) =>
    ipcRenderer.invoke('hostedServer:clearAnalytics', id),
  hostedServerUpdatePlayerTracking: (id: string, playerNames: string[]) =>
    ipcRenderer.invoke('hostedServer:updatePlayerTracking', id, playerNames),
  hostedServerEndAllSessions: (id: string) =>
    ipcRenderer.invoke('hostedServer:endAllSessions', id),
  onHostedServerConsole: (
    callback: (data: { serverId: string; lines: string[] }) => void
  ) => {
    const handler = (_event: unknown, data: { serverId: string; lines: string[] }): void =>
      callback(data)
    ipcRenderer.on('hostedServer:console', handler)
    return () => ipcRenderer.removeListener('hostedServer:console', handler)
  },
  onLauncherLog: (
    callback: (line: string) => void
  ) => {
    const handler = (_event: unknown, line: string): void => callback(line)
    ipcRenderer.on('launcher:log', handler)
    return () => ipcRenderer.removeListener('launcher:log', handler)
  },
  onHostedServerStatusChange: (
    callback: (status: Record<string, unknown>) => void
  ) => {
    const handler = (_event: unknown, status: Record<string, unknown>): void => callback(status)
    ipcRenderer.on('hostedServer:statusChange', handler)
    return () => ipcRenderer.removeListener('hostedServer:statusChange', handler)
  },
  onHostedServerExeStatus: (
    callback: (status: string) => void
  ) => {
    const handler = (_event: unknown, status: string): void => callback(status)
    ipcRenderer.on('hostedServer:exeStatus', handler)
    return () => ipcRenderer.removeListener('hostedServer:exeStatus', handler)
  },

  // Mod Registry
  registryGetStatus: () =>
    ipcRenderer.invoke('registry:getStatus'),
  registryUpdateIndex: () =>
    ipcRenderer.invoke('registry:updateIndex') as Promise<{ updated: boolean; error?: string }>,
  registrySearch: (options: Record<string, unknown>) =>
    ipcRenderer.invoke('registry:search', options),
  registryGetMod: (identifier: string) =>
    ipcRenderer.invoke('registry:getMod', identifier),
  registryGetUpdatesAvailable: () =>
    ipcRenderer.invoke('registry:getUpdatesAvailable'),
  registryGetInstalled: () =>
    ipcRenderer.invoke('registry:getInstalled'),
  registryResolve: (identifiers: string[]) =>
    ipcRenderer.invoke('registry:resolve', identifiers),
  registryCheckReverseDeps: (identifiers: string[]) =>
    ipcRenderer.invoke('registry:checkReverseDeps', identifiers) as Promise<string[]>,
  registryInstall: (identifiers: string[], targetServerId?: string) =>
    ipcRenderer.invoke('registry:install', identifiers, targetServerId) as Promise<{ success: boolean; error?: string; installed?: string[] }>,
  registryTrackInstall: (
    metadata: Record<string, unknown>,
    installedFiles: string[],
    source: string,
    autoInstalled: boolean
  ) =>
    ipcRenderer.invoke('registry:trackInstall', metadata, installedFiles, source, autoInstalled),
  registryTrackRemoval: (identifier: string) =>
    ipcRenderer.invoke('registry:trackRemoval', identifier),
  registryGetRepositories: () =>
    ipcRenderer.invoke('registry:getRepositories'),
  registrySetRepositories: (repos: Array<Record<string, unknown>>) =>
    ipcRenderer.invoke('registry:setRepositories', repos),
  registryExportModpack: (name: string) =>
    ipcRenderer.invoke('registry:exportModpack', name),
  registryImportModpack: (modpackJson: string) =>
    ipcRenderer.invoke('registry:importModpack', modpackJson),
  registryGetSupporters: (identifier: string) =>
    ipcRenderer.invoke('registry:getSupporters', identifier),
  onRegistryDownloadProgress: (
    callback: (progress: { identifier: string; received: number; total: number; fileName: string }) => void
  ): (() => void) => {
    const handler = (_event: unknown, progress: { identifier: string; received: number; total: number; fileName: string }): void => {
      callback(progress)
    }
    ipcRenderer.on('registry:downloadProgress', handler)
    return () => ipcRenderer.removeListener('registry:downloadProgress', handler)
  },

  // News feed
  getNewsFeed: () =>
    ipcRenderer.invoke('news:getFeed') as Promise<
      Array<{
        id: string
        source: 'steam' | 'beammp'
        title: string
        url: string
        date: number
        summary: string
      }>
    >,

  // Tailscale
  getTailscaleStatus: () =>
    ipcRenderer.invoke('tailscale:getStatus') as Promise<{
      installed: boolean
      running: boolean
      ip: string | null
      hostname: string | null
      tailnet: string | null
      peers: Array<{ hostname: string; ip: string; os: string; online: boolean }>
    }>,

  // Auto-Updater
  onUpdateAvailable: (callback: (info: { version: string; releaseDate: string }) => void) => {
    const handler = (_event: unknown, info: { version: string; releaseDate: string }): void => callback(info)
    ipcRenderer.on('updater:update-available', handler)
    return () => ipcRenderer.removeListener('updater:update-available', handler)
  },
  onUpdateDownloadProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => {
    const handler = (_event: unknown, progress: { percent: number; transferred: number; total: number }): void => callback(progress)
    ipcRenderer.on('updater:download-progress', handler)
    return () => ipcRenderer.removeListener('updater:download-progress', handler)
  },
  onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
    const handler = (_event: unknown, info: { version: string }): void => callback(info)
    ipcRenderer.on('updater:update-downloaded', handler)
    return () => ipcRenderer.removeListener('updater:update-downloaded', handler)
  },
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  // Career Save Management
  careerListProfiles: () =>
    ipcRenderer.invoke('career:listProfiles'),
  careerGetSlotMetadata: (profileName: string, slotName: string) =>
    ipcRenderer.invoke('career:getSlotMetadata', profileName, slotName),
  careerGetProfileSummary: (profileName: string) =>
    ipcRenderer.invoke('career:getProfileSummary', profileName),
  careerGetLog: (profileName: string) =>
    ipcRenderer.invoke('career:getCareerLog', profileName) as Promise<string[]>,
  careerDeployProfile: (profileName: string) =>
    ipcRenderer.invoke('career:deployProfile', profileName) as Promise<{ success: boolean; error?: string }>,
  careerUndeployProfile: (profileName: string) =>
    ipcRenderer.invoke('career:undeployProfile', profileName) as Promise<{ success: boolean; error?: string }>,
  careerBackupSlot: (profileName: string, slotName: string) =>
    ipcRenderer.invoke('career:backupSlot', profileName, slotName) as Promise<{ success: boolean; backupName?: string; error?: string }>,
  careerBackupProfile: (profileName: string) =>
    ipcRenderer.invoke('career:backupProfile', profileName) as Promise<{ success: boolean; backupName?: string; error?: string }>,
  careerListProfileBackups: (profileName?: string) =>
    ipcRenderer.invoke('career:listProfileBackups', profileName),
  careerRestoreProfileBackup: (backupName: string) =>
    ipcRenderer.invoke('career:restoreProfileBackup', backupName) as Promise<{ success: boolean; error?: string }>,
  careerDeleteProfileBackup: (backupName: string) =>
    ipcRenderer.invoke('career:deleteProfileBackup', backupName) as Promise<{ success: boolean; error?: string }>,
  careerSetSavePath: (savePath: string | null) =>
    ipcRenderer.invoke('career:setSavePath', savePath) as Promise<{ success: boolean; error?: string }>,
  careerBrowseSavePath: () =>
    ipcRenderer.invoke('career:browseSavePath') as Promise<string | null>,
  careerGetSavePath: () =>
    ipcRenderer.invoke('career:getSavePath') as Promise<string | null>,
  careerRecordServerAssociation: (profileName: string, serverIdent: string, serverName: string | null) =>
    ipcRenderer.invoke('career:recordServerAssociation', profileName, serverIdent, serverName) as Promise<void>,
  careerGetServerAssociations: () =>
    ipcRenderer.invoke('career:getServerAssociations') as Promise<Record<string, { serverIdent: string; serverName: string | null; lastPlayed: string }>>,

  // Career Mod Management
  careerFetchCareerMPReleases: () =>
    ipcRenderer.invoke('career:fetchCareerMPReleases'),
  careerFetchRLSReleases: () =>
    ipcRenderer.invoke('career:fetchRLSReleases'),
  careerInstallCareerMP: (downloadUrl: string, version: string, serverDir: string) =>
    ipcRenderer.invoke('career:installCareerMP', downloadUrl, version, serverDir) as Promise<{ success: boolean; error?: string }>,
  careerInstallRLS: (downloadUrl: string, version: string, traffic: boolean, serverDir: string) =>
    ipcRenderer.invoke('career:installRLS', downloadUrl, version, traffic, serverDir) as Promise<{ success: boolean; error?: string }>,
  careerGetInstalledMods: (serverDir: string) =>
    ipcRenderer.invoke('career:getInstalledMods', serverDir),
  careerBrowseServerDir: () =>
    ipcRenderer.invoke('career:browseServerDir') as Promise<string | null>,
  careerGetServerDir: (serverId: string) =>
    ipcRenderer.invoke('career:getServerDir', serverId) as Promise<string>,

  // Controls / Input Bindings
  controlsGetDevices: () =>
    ipcRenderer.invoke('controls:getDevices'),
  controlsGetActions: () =>
    ipcRenderer.invoke('controls:getActions'),
  controlsGetCategories: () =>
    ipcRenderer.invoke('controls:getCategories'),
  controlsGetBindings: (deviceFileName: string) =>
    ipcRenderer.invoke('controls:getBindings', deviceFileName),
  controlsSetBinding: (deviceFileName: string, binding: unknown) =>
    ipcRenderer.invoke('controls:setBinding', deviceFileName, binding),
  controlsRemoveBinding: (deviceFileName: string, control: string, action: string) =>
    ipcRenderer.invoke('controls:removeBinding', deviceFileName, control, action),
  controlsResetDevice: (deviceFileName: string) =>
    ipcRenderer.invoke('controls:resetDevice', deviceFileName),
  controlsSetFFBConfig: (deviceFileName: string, control: string, ffb: unknown) =>
    ipcRenderer.invoke('controls:setFFBConfig', deviceFileName, control, ffb),
  controlsGetSteeringSettings: () =>
    ipcRenderer.invoke('controls:getSteeringSettings'),
  controlsSetSteeringSettings: (settings: unknown) =>
    ipcRenderer.invoke('controls:setSteeringSettings', settings),
  controlsListPresets: () =>
    ipcRenderer.invoke('controls:listPresets'),
  controlsSavePreset: (name: string, deviceFileName: string, device: unknown) =>
    ipcRenderer.invoke('controls:savePreset', name, deviceFileName, device),
  controlsLoadPreset: (presetId: string) =>
    ipcRenderer.invoke('controls:loadPreset', presetId),
  controlsDeletePreset: (presetId: string) =>
    ipcRenderer.invoke('controls:deletePreset', presetId),
  controlsExportPreset: (presetId: string) =>
    ipcRenderer.invoke('controls:exportPreset', presetId),
  controlsImportPreset: (jsonString: string) =>
    ipcRenderer.invoke('controls:importPreset', jsonString),

  // GPS Tracker
  gpsDeployTracker: () =>
    ipcRenderer.invoke('gps:deployTracker'),
  gpsUndeployTracker: () =>
    ipcRenderer.invoke('gps:undeployTracker'),
  gpsIsTrackerDeployed: () =>
    ipcRenderer.invoke('gps:isTrackerDeployed'),
  gpsGetTelemetry: () =>
    ipcRenderer.invoke('gps:getTelemetry'),
  gpsGetMapPOIs: (mapName: string) =>
    ipcRenderer.invoke('gps:getMapPOIs', mapName) as Promise<import('../shared/types').GPSMapPOI[]>,

  // Voice Chat
  voiceEnable: () =>
    ipcRenderer.invoke('voice:enable') as Promise<{ success: boolean; error?: string }>,
  voiceDisable: () =>
    ipcRenderer.invoke('voice:disable') as Promise<{ success: boolean; error?: string }>,
  voiceSendSignal: (data: string) =>
    ipcRenderer.invoke('voice:sendSignal', data),
  voiceGetState: () =>
    ipcRenderer.invoke('voice:getState') as Promise<import('../shared/types').VoiceChatState>,
  voiceUpdateSettings: (settings: import('../shared/types').VoiceChatSettings) =>
    ipcRenderer.invoke('voice:updateSettings', settings),
  voiceDeployBridge: () =>
    ipcRenderer.invoke('voice:deployBridge') as Promise<{ success: boolean; error?: string }>,
  voiceUndeployBridge: () =>
    ipcRenderer.invoke('voice:undeployBridge') as Promise<{ success: boolean; error?: string }>,
  onVoicePeerJoined: (callback: (data: { playerId: number; playerName: string }) => void) => {
    const handler = (_event: unknown, data: { playerId: number; playerName: string }): void => callback(data)
    ipcRenderer.on('voice:peerJoined', handler)
    return () => { ipcRenderer.removeListener('voice:peerJoined', handler) }
  },
  onVoicePeerLeft: (callback: (data: { playerId: number }) => void) => {
    const handler = (_event: unknown, data: { playerId: number }): void => callback(data)
    ipcRenderer.on('voice:peerLeft', handler)
    return () => { ipcRenderer.removeListener('voice:peerLeft', handler) }
  },
  onVoiceSignal: (callback: (data: { fromId: number; payload: string }) => void) => {
    const handler = (_event: unknown, data: { fromId: number; payload: string }): void => callback(data)
    ipcRenderer.on('voice:signal', handler)
    return () => { ipcRenderer.removeListener('voice:signal', handler) }
  },

  // Livery Editor
  liveryGetUVTemplate: (vehicleName: string) =>
    ipcRenderer.invoke('livery:getUVTemplate', vehicleName) as Promise<{ template: string | null; width: number; height: number }>,
  liveryGetSkinMaterials: (vehicleName: string) =>
    ipcRenderer.invoke('livery:getVehicleSkinMaterials', vehicleName) as Promise<Array<{ materialName: string; texturePath: string; uvChannel: 0 | 1; hasPaletteMap: boolean }>>,
  liveryExportSkinMod: (params: {
    vehicleName: string; skinName: string; authorName: string; canvasDataUrl: string
    metallic: number; roughness: number; clearcoat: number; clearcoatRoughness: number
  }) =>
    ipcRenderer.invoke('livery:exportSkinMod', params) as Promise<{ success: boolean; filePath?: string; error?: string }>,
  liverySaveProject: (data: string) =>
    ipcRenderer.invoke('livery:saveProject', data) as Promise<{ success: boolean; filePath?: string; error?: string }>,
  liveryLoadProject: () =>
    ipcRenderer.invoke('livery:loadProject') as Promise<{ success: boolean; data?: string; error?: string }>,
  liveryImportImage: () =>
    ipcRenderer.invoke('livery:importImage') as Promise<string | null>,
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
