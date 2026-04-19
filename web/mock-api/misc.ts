// Mock implementations for: window controls, friends, hosted servers,
// registry, news, tailscale, auto-updater, career, controls, GPS

import { DEMO_NEWS } from './demo-data'

const noop = (): (() => void) => () => {}

const DEMO_FRIENDS = [
  { id: 'friend-1', displayName: 'RacerX', addedAt: Date.now() - 86400000 * 30, notes: 'Great drift partner', tags: ['drift'] },
  { id: 'friend-2', displayName: 'DriftKing', addedAt: Date.now() - 86400000 * 60, notes: '', tags: ['racing'] },
  { id: 'friend-3', displayName: 'Tofu86', addedAt: Date.now() - 86400000 * 10, notes: 'AE86 enthusiast', tags: ['drift', 'touge'] }
]

export const miscMocks = {
  // Window Controls (no-ops in browser)
  minimizeWindow: (): void => {},
  maximizeWindow: (): void => {},
  closeWindow: (): void => {},
  isMaximized: async () => false,
  onMaximizedChange: noop,

  // Friends
  getFriends: async () => [...DEMO_FRIENDS],
  addFriend: async () => [...DEMO_FRIENDS],
  removeFriend: async () => [...DEMO_FRIENDS],
  updateFriend: async () => [...DEMO_FRIENDS],
  getFriendSessions: async () => [
    { serverIdent: '1.2.3.4:30814', serverName: 'Freeroam | West Coast USA', players: ['RacerX', 'DriftKing'], timestamp: Date.now() - 1800000 }
  ],
  recordFriendSession: async (): Promise<void> => {},

  // Hosted Server Manager
  hostedServerList: async () => [],
  hostedServerCreate: async () => ({ id: 'demo-1', name: 'Demo Server', port: 30814, authKey: '', maxPlayers: 8, maxCars: 1, map: '/levels/gridmap_v2/info.json', private: false, description: '', resourceFolder: '', tags: '', allowGuests: true, logChat: true, debug: false }),
  hostedServerUpdate: async (_id: string, partial: Record<string, unknown>) => ({ id: 'demo-1', name: 'Demo Server', port: 30814, authKey: '', maxPlayers: 8, maxCars: 1, map: '/levels/gridmap_v2/info.json', private: false, description: '', resourceFolder: '', tags: '', allowGuests: true, logChat: true, debug: false, ...partial }),
  hostedServerDelete: async (): Promise<void> => {},
  hostedServerStart: async () => ({ success: false, error: 'Demo mode' }),
  hostedServerStop: async () => ({ success: false }),
  hostedServerRestart: async () => ({ success: false, error: 'Demo mode' }),
  hostedServerGetConsole: async () => ['[Demo] Server console not available in web demo'],
  hostedServerSendCommand: async (): Promise<void> => {},
  hostedServerGetExeStatus: async () => 'missing' as const,
  hostedServerDownloadExe: async () => ({ success: false, error: 'Demo mode' }),
  hostedServerInstallExe: async () => 'missing',
  hostedServerBrowseExe: async () => null,
  hostedServerListFiles: async () => [],
  hostedServerDeployedMods: async () => [],
  hostedServerUndeployMod: async (): Promise<void> => {},
  hostedServerGetServersWithMod: async () => [],
  hostedServerDeleteFile: async (): Promise<void> => {},
  hostedServerCreateFolder: async (): Promise<void> => {},
  hostedServerCopyMod: async () => '',
  hostedServerAddFiles: async () => [],
  hostedServerReadFile: async () => '',
  hostedServerWriteFile: async (): Promise<void> => {},
  hostedServerExtractZip: async () => ({ success: false, extracted: 0 }),
  hostedServerTestPort: async () => ({ open: false, error: 'Demo mode' }),
  hostedServerSaveCustomImage: async () => '',
  hostedServerRemoveCustomImage: async (): Promise<void> => {},
  hostedServerGetCustomImage: async () => null,
  hostedServerGetRoutes: async () => [],
  hostedServerSaveRoute: async () => [],
  hostedServerDeleteRoute: async () => [],
  hostedServerGetPlayerPositions: async () => [],
  hostedServerDeployTracker: async (): Promise<void> => {},

  // Backup Schedule
  hostedServerGetSchedule: async () => ({ enabled: false, frequency: 'daily' as const, timeOfDay: '03:00', dayOfWeek: 0, maxBackups: 5, lastBackup: null, nextBackup: null }),
  hostedServerSaveSchedule: async (_id: string, schedule: Record<string, unknown>) => ({ enabled: false, frequency: 'daily' as const, timeOfDay: '03:00', dayOfWeek: 0, maxBackups: 5, lastBackup: null, nextBackup: null, ...schedule }),
  hostedServerCreateBackup: async () => ({ filename: 'demo-backup.zip', size: 0, createdAt: Date.now() }),
  hostedServerListBackups: async () => [],
  hostedServerDeleteBackup: async (): Promise<void> => {},
  hostedServerRestoreBackup: async (): Promise<void> => {},

  // Scheduled Tasks
  hostedServerGetTasks: async () => [],
  hostedServerSaveTask: async () => [],
  hostedServerCreateTask: async () => [],
  hostedServerDeleteTask: async () => [],
  hostedServerRunTaskNow: async () => [],

  // Analytics
  hostedServerGetAnalytics: async () => ({ dailyStats: [], playerSummaries: [], activeSessions: [] }),
  hostedServerClearAnalytics: async (): Promise<void> => {},
  hostedServerUpdatePlayerTracking: async (): Promise<void> => {},
  hostedServerEndAllSessions: async (): Promise<void> => {},
  onHostedServerConsole: noop,
  onLauncherLog: noop,
  onHostedServerStatusChange: noop,
  onHostedServerExeStatus: noop,

  // Mod Registry
  registryGetStatus: async () => ({ indexLoaded: false, modCount: 0, lastUpdated: null, repositories: [] }),
  registryUpdateIndex: async () => ({ updated: false, error: 'Demo mode' }),
  registrySearch: async () => ({ results: [], total: 0, page: 1, pageSize: 20 }),
  registryGetMod: async () => null,
  registryGetUpdatesAvailable: async () => [],
  registryGetInstalled: async () => ({}),
  registryResolve: async () => ({ resolved: [], missing: [], conflicts: [] }),
  registryCheckReverseDeps: async () => [],
  registryInstall: async () => ({ success: false, error: 'Demo mode' }),
  registryTrackInstall: async (): Promise<void> => {},
  registryTrackRemoval: async (): Promise<void> => {},
  registryGetRepositories: async () => [],
  registrySetRepositories: async (): Promise<void> => {},
  registryExportModpack: async () => ({ name: 'demo', mods: [] }),
  registryImportModpack: async () => ({ identifiers: [], missing: [], error: 'Demo mode' }),
  registryGetSupporters: async () => [],
  onRegistryDownloadProgress: noop,

  // News feed
  getNewsFeed: async () => DEMO_NEWS,

  // Tailscale
  getTailscaleStatus: async () => ({ installed: false, running: false, ip: null, hostname: null, tailnet: null, peers: [] }),

  // Auto-Updater
  onUpdateAvailable: noop,
  onUpdateDownloadProgress: noop,
  onUpdateDownloaded: noop,
  installUpdate: async (): Promise<void> => {},

  // Career Save Management
  careerListProfiles: async () => [],
  careerGetSlotMetadata: async () => null,
  careerGetProfileSummary: async () => null,
  careerGetLog: async () => [],
  careerDeployProfile: async () => ({ success: false, error: 'Demo mode' }),
  careerUndeployProfile: async () => ({ success: false, error: 'Demo mode' }),
  careerBackupSlot: async () => ({ success: false, error: 'Demo mode' }),
  careerBackupProfile: async () => ({ success: false, error: 'Demo mode' }),
  careerListProfileBackups: async () => [],
  careerRestoreProfileBackup: async () => ({ success: false, error: 'Demo mode' }),
  careerDeleteProfileBackup: async () => ({ success: false, error: 'Demo mode' }),
  careerSetSavePath: async () => ({ success: false, error: 'Demo mode' }),
  careerBrowseSavePath: async () => null,
  careerGetSavePath: async () => null,
  careerRecordServerAssociation: async () => {},
  careerGetServerAssociations: async () => ({}),

  // Career Mod Management
  careerFetchCareerMPReleases: async () => [],
  careerFetchRLSReleases: async () => [],
  careerInstallCareerMP: async () => ({ success: false, error: 'Demo mode' }),
  careerInstallRLS: async () => ({ success: false, error: 'Demo mode' }),
  careerGetInstalledMods: async () => ({ careerMP: null, rls: null }),
  careerBrowseServerDir: async () => null,
  careerGetServerDir: async () => '',

  // Career Plugin Browser
  careerListPluginCatalog: async () => [],
  careerFetchPluginReleases: async () => [],
  careerInstallPlugin: async () => ({ success: false, error: 'Demo mode' }),
  careerUninstallPlugin: async () => ({ success: false, error: 'Demo mode' }),
  careerGetInstalledPlugins: async () => ({}),

  // Server Admin Tools Plugin Browser
  serverAdminListPluginCatalog: async () => [],
  serverAdminFetchPluginReleases: async () => [],
  serverAdminInstallPlugin: async () => ({ success: false, error: 'Demo mode' }),
  serverAdminUninstallPlugin: async () => ({ success: false, error: 'Demo mode' }),
  serverAdminGetInstalledPlugins: async () => ({}),

  // Controls / Input Bindings
  controlsGetDevices: async () => [],
  controlsGetActions: async () => [],
  controlsGetCategories: async () => [],
  controlsGetBindings: async () => null,
  controlsSetBinding: async () => ({ bindings: {}, defaults: {}, device: { fileName: '', name: '', devicetype: 'keyboard' as const, vidpid: '', hasUserOverrides: false } }),
  controlsRemoveBinding: async () => ({ bindings: {}, defaults: {}, device: { fileName: '', name: '', devicetype: 'keyboard' as const, vidpid: '', hasUserOverrides: false } }),
  controlsResetDevice: async (): Promise<void> => {},
  controlsSetFFBConfig: async () => ({ bindings: {}, defaults: {}, device: { fileName: '', name: '', devicetype: 'keyboard' as const, vidpid: '', hasUserOverrides: false } }),
  controlsGetSteeringSettings: async () => null,
  controlsSetSteeringSettings: async () => ({}),
  controlsListPresets: async () => [],
  controlsSavePreset: async () => ({ id: 'demo', name: 'Demo', deviceFileName: '', deviceName: '', bindings: {}, createdAt: Date.now() }),
  controlsLoadPreset: async (): Promise<void> => {},
  controlsDeletePreset: async (): Promise<void> => {},
  controlsExportPreset: async () => ({ id: 'demo', name: 'Demo', deviceFileName: '', deviceName: '', bindings: {}, createdAt: Date.now() }),
  controlsImportPreset: async () => ({ id: 'demo', name: 'Demo', deviceFileName: '', deviceName: '', bindings: {}, createdAt: Date.now() }),

  // GPS Tracker
  gpsDeployTracker: async () => ({ success: false, error: 'Demo mode' }),
  gpsUndeployTracker: async () => ({ success: false, error: 'Demo mode' }),
  gpsIsTrackerDeployed: async () => false,
  gpsGetTelemetry: async () => null,
  gpsGetMapPOIs: async () => []
}
