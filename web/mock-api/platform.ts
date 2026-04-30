// Mock implementations for Discord Rich Presence, window controls, GPS, and
// updater event hooks. All no-ops in the web demo, but provided explicitly
// so the renderer's bootstrap code (which calls many of these synchronously)
// behaves correctly.

const noop = (): (() => void) => () => {}

export const platformMocks = {
  // Discord Rich Presence
  discordSetPage: (_pageId: string): void => {},
  discordSetPlaying: (_info: unknown): void => {},
  discordClearPlaying: (): void => {},

  // Auto-updater
  onUpdateAvailable: noop,
  onUpdateDownloadProgress: noop,
  onUpdateDownloaded: noop,
  checkForAppUpdate: async (): Promise<void> => {},
  checkForUpdates: async (): Promise<void> => {},
  installUpdate: async (): Promise<void> => {},
  quitAndInstall: async (): Promise<void> => {},

  // Window controls (no-op in browser; the web demo doesn't have a frame)
  minimizeWindow: (): void => {},
  maximizeWindow: (): void => {},
  closeWindow: (): void => {},
  isMaximized: async (): Promise<boolean> => false,
  onMaximizedChange: noop,

  // Environment
  getTailscaleStatus: async () => ({
    installed: false,
    running: false,
    ip: null,
    error: 'Tailscale unavailable in web demo'
  }),

  // GPS / Live tracker
  gpsDeployTracker: async (): Promise<{ success: boolean; error?: string }> => ({
    success: false,
    error: 'Demo mode — GPS tracker requires the desktop app.'
  }),
  gpsUndeployTracker: async (): Promise<{ success: boolean; error?: string }> => ({
    success: false,
    error: 'Demo mode'
  }),
  gpsIsTrackerDeployed: async (): Promise<boolean> => false,
  gpsGetTelemetry: async (): Promise<null> => null,
  gpsGetMapPOIs: async (): Promise<unknown[]> => [],

  // Repo proxies (web demo can't install mods directly)
  getRepoCategories: async () => [
    { id: 1, name: 'Cars', count: 0 },
    { id: 2, name: 'Maps', count: 0 },
    { id: 3, name: 'Skins', count: 0 },
    { id: 4, name: 'Mods of Mods', count: 0 }
  ],
  browseRepoMods: async () => ({ items: [], totalPages: 0, currentPage: 1 }),
  searchRepoMods: async () => ({ items: [], totalPages: 0, currentPage: 1 }),
  getRepoThumbnails: async (urls: string[]): Promise<Record<string, string>> => {
    const out: Record<string, string> = {}
    for (const url of urls) out[url] = url
    return out
  },
  openModPage: async (url: string): Promise<void> => {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
  },
  downloadRepoMod: async (): Promise<{ success: boolean; error?: string }> => ({
    success: false,
    error: 'Demo mode — install the desktop app to download mods.'
  }),
  onRepoDownloadProgress: noop,
  beamngWebLogin: async (): Promise<{ success: boolean }> => ({ success: false }),
  beamngWebLoggedIn: async (): Promise<{ loggedIn: boolean; username: string }> => ({
    loggedIn: false,
    username: ''
  }),
  beamngWebLogout: async (): Promise<void> => {}
}
