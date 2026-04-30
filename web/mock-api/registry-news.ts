// Mod Registry, News, and other home-page feed mocks. Returns empty/placeholder
// data sized to make the HomePage render without errors or empty crashes.

const noop = (): (() => void) => () => {}

export const registryMocks = {
  registryGetStatus: async () => ({
    initialized: true,
    repositoryCount: 0,
    indexedModCount: 0,
    lastUpdate: null as number | null
  }),
  registryUpdateIndex: async () => ({ success: true, indexedModCount: 0 }),
  registrySearch: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
  registryGetMod: async (): Promise<null> => null,
  registryResolve: async () => ({ resolved: [], conflicts: [], missing: [] }),
  registryCheckReverseDeps: async () => [],
  registryInstall: async () => ({
    success: false,
    error: 'Demo mode — installing mods requires the desktop app.'
  }),
  registryTrackInstall: async (): Promise<void> => {},
  registryExportModpack: async () => ({
    success: false,
    error: 'Demo mode'
  }),
  registryGetUpdatesAvailable: async (): Promise<unknown[]> => [],
  registryGetInstalled: async (): Promise<Record<string, unknown>> => ({}),
  registryListRepositories: async () => [],
  registryAddRepository: async () => ({ success: false, error: 'Demo mode' }),
  registryRemoveRepository: async () => ({ success: false, error: 'Demo mode' }),
  onRegistryDownloadProgress: noop,
}

export const newsMocks = {
  getNewsFeed: async () => [
    {
      id: 'demo-1',
      source: 'BeamMP Blog',
      title: 'Welcome to the BeamMP Content Manager web demo',
      url: 'https://github.com/MusaNajam11/BeamNG-Content-Manager',
      date: new Date().toISOString(),
      summary: 'You are exploring an in-browser preview. Download the desktop app to manage real mods, launch BeamNG, host your own multiplayer server, and more.'
    },
    {
      id: 'demo-2',
      source: 'BeamNG.drive',
      title: 'BeamNG.drive — latest update notes',
      url: 'https://www.beamng.com/game/news/',
      date: new Date(Date.now() - 86_400_000 * 3).toISOString(),
      summary: 'Read the latest patch notes for BeamNG.drive on the official site.'
    },
    {
      id: 'demo-3',
      source: 'Community',
      title: 'Top 5 community drift maps worth trying',
      url: 'https://www.beamng.com/resources/categories/maps.5/',
      date: new Date(Date.now() - 86_400_000 * 7).toISOString(),
      summary: 'Showcase of community-built drift maps from the BeamNG repository.'
    }
  ],

  recordNewsClick: async (): Promise<void> => {},
  recordNewsImpression: async (): Promise<void> => {},
  getAnalyticsEvents: async () => []
}
