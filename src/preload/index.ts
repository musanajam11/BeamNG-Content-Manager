import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateConfig: (partial: Record<string, unknown>) => ipcRenderer.invoke('config:update', partial),
  markSetupComplete: () => ipcRenderer.invoke('config:markSetupComplete'),

  // Appearance
  setZoomFactor: (factor: number) => ipcRenderer.invoke('appearance:setZoom', factor),
  getZoomFactor: () => ipcRenderer.invoke('appearance:getZoom') as Promise<number>,
  pickBackgroundImage: () => ipcRenderer.invoke('appearance:pickBackgroundImage') as Promise<string | null>,
  loadBackgroundImage: (filePath: string) =>
    ipcRenderer.invoke('appearance:loadBackgroundImage', filePath) as Promise<string | null>,
  getDefaultBackgrounds: () =>
    ipcRenderer.invoke('appearance:getDefaultBackgrounds') as Promise<string[]>,
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
    ipcRenderer.invoke('game:listMaps') as Promise<{ name: string; source: 'stock' | 'mod' }[]>,
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
    ipcRenderer.invoke('game:getActiveVehicleMeshes', vehicleName, configParts) as Promise<string[]>,
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
  joinServer: (ip: string, port: number) => ipcRenderer.invoke('game:joinServer', ip, port),
  beammpLogin: (username: string, password: string) => ipcRenderer.invoke('game:beammpLogin', username, password),
  beammpLoginAsGuest: () => ipcRenderer.invoke('game:beammpLoginAsGuest'),
  beammpLogout: () => ipcRenderer.invoke('game:beammpLogout'),
  getAuthInfo: () => ipcRenderer.invoke('game:getAuthInfo'),
  getLauncherLogs: () => ipcRenderer.invoke('game:getLauncherLogs'),

  // Backend
  getServers: () => ipcRenderer.invoke('backend:getServers'),
  login: (username: string, password: string) =>
    ipcRenderer.invoke('backend:login', username, password),
  checkBackendHealth: () => ipcRenderer.invoke('backend:checkHealth'),
  setBackendUrl: (url: string) => ipcRenderer.invoke('backend:setUrl', url),

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

  // Mods
  getMods: () => ipcRenderer.invoke('mods:list'),
  toggleMod: (modKey: string, enabled: boolean) => ipcRenderer.invoke('mods:toggle', modKey, enabled),
  deleteMod: (modKey: string) => ipcRenderer.invoke('mods:delete', modKey),
  installMod: () => ipcRenderer.invoke('mods:install'),
  openModsFolder: () => ipcRenderer.invoke('mods:openFolder'),
  getModPreview: (filePath: string) => ipcRenderer.invoke('mods:preview', filePath),

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
  installUpdate: () => ipcRenderer.invoke('updater:install')
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
