// Mock implementations for backend, servers, flags, favorites, recent servers

import { DEMO_SERVERS } from './demo-data'

export const serverMocks = {
  // Backend / Servers
  getServers: async () => ({ success: true, data: DEMO_SERVERS }),
  login: async () => ({ success: false, error: 'Demo mode' }),
  checkBackendHealth: async () => true,
  setBackendUrl: async (): Promise<void> => {},
  setAuthUrl: async (): Promise<void> => {},
  setUseOfficialBackend: async (): Promise<void> => {},

  // Flag Images
  getFlags: async (codes: string[]) => {
    const result: Record<string, string> = {}
    for (const code of codes) {
      // Return empty — flags won't render but UI won't break
      result[code] = ''
    }
    return result
  },

  // Favorites
  getFavorites: async (): Promise<string[]> => ['1.2.3.4:30814', '10.0.0.1:30814'],
  setFavorite: async (_ident: string, _fav: boolean): Promise<string[]> => ['1.2.3.4:30814', '10.0.0.1:30814'],

  // Recent Servers
  getRecentServers: async () => [
    { ident: '1.2.3.4:30814', timestamp: Date.now() - 3600000 },
    { ident: '5.6.7.8:30814', timestamp: Date.now() - 86400000 }
  ],

  // Server Queue
  queueStart: async () => ({ success: false }),
  queueStop: async () => ({ cancelled: false }),
  queueGetStatus: async () => ({
    active: false,
    ip: null,
    port: null,
    sname: null,
    elapsed: 0
  }),
  onQueueStatus: (): (() => void) => () => {},
  onQueueJoined: (): (() => void) => () => {},
  onModSyncProgress: (): (() => void) => () => {}
}
