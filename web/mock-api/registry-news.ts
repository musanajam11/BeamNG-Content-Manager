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
  // Repository list shown in SettingsPage. Renderer iterates with .map(), so
  // we must return an array (not undefined) — the auto-stub falls through to
  // undefined for `registryGet*` keys not matched by the heuristic regex.
  registryGetRepositories: async (): Promise<Array<{ name: string; url: string; priority: number }>> => [
    { name: 'BeamMP Mod Repository', url: 'https://www.beamng.com/resources/categories/multiplayer.43/', priority: 0 }
  ],
  registrySetRepositories: async (): Promise<{ success: true }> => ({ success: true }),
  // Must match RegistrySearchResult in src/shared/registry-types.ts:
  //   { mods: AvailableMod[]; total: number; page: number; per_page: number; total_pages: number }
  registrySearch: async () => ({ mods: [], total: 0, page: 1, per_page: 25, total_pages: 1 }),
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
  // Schema must match the desktop preload's getNewsFeed signature exactly:
  // { id, source: 'steam' | 'beammp', title, url, date: number (unix seconds), summary }
  getNewsFeed: async (): Promise<Array<{
    id: string
    source: 'steam' | 'beammp'
    title: string
    url: string
    date: number
    summary: string
  }>> => {
    const nowSec = Math.floor(Date.now() / 1000)
    const day = 86_400
    return [
      {
        id: 'demo-1',
        source: 'beammp',
        title: 'Welcome to the BeamMP Content Manager web demo',
        url: 'https://github.com/MusaNajam11/BeamNG-Content-Manager',
        date: nowSec,
        summary: 'You are exploring an in-browser preview. Download the desktop app to manage real mods, launch BeamNG, host your own multiplayer server, and more.'
      },
      {
        id: 'demo-2',
        source: 'steam',
        title: 'BeamNG.drive — latest update notes',
        url: 'https://www.beamng.com/game/news/',
        date: nowSec - day * 3,
        summary: 'Read the latest patch notes for BeamNG.drive on the official site.'
      },
      {
        id: 'demo-3',
        source: 'beammp',
        title: 'Top 5 community drift maps worth trying',
        url: 'https://www.beamng.com/resources/categories/maps.5/',
        date: nowSec - day * 7,
        summary: 'Showcase of community-built drift maps from the BeamNG repository.'
      }
    ]
  },

  recordNewsClick: async (): Promise<void> => {},
  recordNewsImpression: async (): Promise<void> => {},
  getAnalyticsEvents: async () => []
}
