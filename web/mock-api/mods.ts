// Mock implementations for mod management, load order, conflicts, and repository

import { DEMO_MODS } from './demo-data'

const noop = (): (() => void) => () => {}

export const modMocks = {
  // Mods
  getMods: async () => ({ success: true, data: [...DEMO_MODS] }),
  toggleMod: async () => ({ success: true }),
  deleteMod: async () => ({ success: true }),
  installMod: async () => ({ success: false, error: 'Demo mode — file picker not available' }),
  updateModScope: async () => ({ success: true }),
  updateModType: async () => ({ success: true }),
  openModsFolder: async (): Promise<void> => {},
  getModPreview: async () => ({ success: true, data: null }),

  // Mod Load Order
  getModLoadOrder: async () => ({
    success: true,
    data: {
      version: 1 as const,
      orders: Object.fromEntries(DEMO_MODS.map((m, i) => [m.key, i]))
    }
  }),
  setModLoadOrder: async () => ({ success: true }),
  toggleLoadOrderEnforcement: async () => ({ success: true }),

  // Mod Conflicts
  scanModConflicts: async () => ({
    success: true,
    data: { conflicts: [], scannedMods: DEMO_MODS.map((m) => m.key), timestamp: Date.now() }
  }),
  getModConflicts: async () => ({ success: true, data: { overridden: [], wins: [] } }),
  hostedServerGetModLoadOrder: async () => ({
    success: true,
    data: { version: 1 as const, orders: {} }
  }),
  hostedServerSetModLoadOrder: async () => ({ success: true }),

  // Mod Repository
  browseRepoMods: async () => ({
    success: true,
    data: {
      mods: [
        { resourceId: 12345, slug: 'cherrier-vivace-track', title: 'Cherrier Vivace Track Edition', version: '1.2.0', author: 'BeamNG', category: 'Vehicles', categoryId: 1, tagLine: 'High-performance track variant', thumbnailUrl: '', rating: 4.8, ratingCount: 234, downloads: 15600, subscriptions: 890, prefix: null, pageUrl: '#' },
        { resourceId: 67890, slug: 'pike-peak', title: 'Pikes Peak Hill Climb', version: '2.1.0', author: 'MapMakerPro', category: 'Maps', categoryId: 2, tagLine: 'Famous hill climb course', thumbnailUrl: '', rating: 4.9, ratingCount: 567, downloads: 42000, subscriptions: 2100, prefix: null, pageUrl: '#' },
        { resourceId: 11111, slug: 'drift-tires', title: 'Ultimate Drift Tires Pack', version: '3.0.1', author: 'DriftMod', category: 'Parts', categoryId: 3, tagLine: 'Low-grip tires for all vehicles', thumbnailUrl: '', rating: 4.5, ratingCount: 189, downloads: 28000, subscriptions: 950, prefix: null, pageUrl: '#' }
      ],
      currentPage: 1,
      totalPages: 1
    }
  }),
  searchRepoMods: async () => ({
    success: true,
    data: { mods: [], currentPage: 1, totalPages: 0 }
  }),
  getRepoCategories: async () => [
    { id: 0, slug: 'all', label: 'All' },
    { id: 1, slug: 'vehicles', label: 'Vehicles' },
    { id: 2, slug: 'maps', label: 'Maps' },
    { id: 3, slug: 'parts', label: 'Parts & Configs' },
    { id: 4, slug: 'skins', label: 'Skins' }
  ],
  openModPage: async (): Promise<void> => {},
  downloadRepoMod: async () => ({ success: false, error: 'Demo mode' }),
  onRepoDownloadProgress: noop,
  getRepoThumbnails: async () => ({} as Record<string, string>),
  beamngWebLogin: async () => ({ success: false }),
  beamngWebLoggedIn: async () => ({ loggedIn: false, username: '' }),
  beamngWebLogout: async (): Promise<void> => {}
}
