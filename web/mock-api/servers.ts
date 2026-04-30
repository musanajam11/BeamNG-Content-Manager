// Mock implementations for backend, servers, flags, favorites, recent servers.
// Tries to fetch the live BeamMP server list when the browser allows; falls
// back to the bundled DEMO_SERVERS sample if CORS/network blocks us.

import { DEMO_SERVERS } from './demo-data'
import type { ServerInfo } from '../../src/shared/types'

const FAVORITES_KEY = 'bmp-cm-demo:favorites'
const RECENTS_KEY = 'bmp-cm-demo:recent-servers'
const BACKEND_BASE = 'https://backend.beammp.com'

let cachedServers: ServerInfo[] | null = null
let cachedAt = 0
const CACHE_TTL = 60_000

async function fetchLiveServers(): Promise<ServerInfo[] | null> {
  if (cachedServers && Date.now() - cachedAt < CACHE_TTL) return cachedServers
  try {
    const r = await fetch(`${BACKEND_BASE}/servers-info`, {
      // Best effort: many environments will block this with CORS. We treat
      // any failure as "fall back to demo data" so the UI still renders.
      signal: AbortSignal.timeout(5_000)
    })
    if (!r.ok) return null
    const data = (await r.json()) as ServerInfo[]
    if (!Array.isArray(data) || data.length === 0) return null
    cachedServers = data
    cachedAt = Date.now()
    return data
  } catch {
    return null
  }
}

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    return raw ? (JSON.parse(raw) as string[]) : ['1.2.3.4:30814', '10.0.0.1:30814']
  } catch {
    return []
  }
}

function saveFavorites(list: string[]): string[] {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(list)) } catch { /* quota */ }
  return list
}

function loadRecents(): Array<{ ident: string; timestamp: number }> {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (raw) return JSON.parse(raw) as Array<{ ident: string; timestamp: number }>
  } catch { /* fall through */ }
  return [
    { ident: '1.2.3.4:30814', timestamp: Date.now() - 3_600_000 },
    { ident: '5.6.7.8:30814', timestamp: Date.now() - 86_400_000 }
  ]
}

export const serverMocks = {
  // Backend / Servers — try real list first, fall back to demo sample.
  getServers: async (): Promise<{ success: boolean; data?: ServerInfo[]; error?: string }> => {
    const live = await fetchLiveServers()
    if (live && live.length > 0) {
      return { success: true, data: live }
    }
    return { success: true, data: DEMO_SERVERS }
  },

  login: async (username: string, _password: string) => {
    // Web demo can't talk to BeamMP auth servers due to CORS. We simulate a
    // local sign-in and remember the username for the session.
    if (!username) return { success: false, error: 'Enter a username' }
    try { localStorage.setItem('bmp-cm-demo:beammp-user', username) } catch { /* quota */ }
    return {
      success: true,
      username,
      privateKey: '',
      guest: false
    }
  },
  checkBackendHealth: async (): Promise<boolean> => {
    try {
      const r = await fetch(`${BACKEND_BASE}/servers-info`, { signal: AbortSignal.timeout(3000) })
      return r.ok
    } catch { return false }
  },
  setBackendUrl: async (): Promise<void> => {},
  setAuthUrl: async (): Promise<void> => {},
  setUseOfficialBackend: async (): Promise<void> => {},

  // Flag Images — return empty so the UI falls through to a flag-less state
  // (the renderer treats empty strings as "no flag" gracefully).
  getFlags: async (codes: string[]): Promise<Record<string, string>> => {
    const result: Record<string, string> = {}
    for (const code of codes) result[code] = ''
    return result
  },

  // Favorites — backed by localStorage.
  getFavorites: async (): Promise<string[]> => loadFavorites(),
  setFavorite: async (ident: string, favorite: boolean): Promise<string[]> => {
    const list = new Set(loadFavorites())
    if (favorite) list.add(ident)
    else list.delete(ident)
    return saveFavorites([...list])
  },

  // Recent Servers — backed by localStorage.
  getRecentServers: async () => loadRecents(),

  // Server Queue (no-op in demo)
  queueStart: async () => ({ success: false, error: 'Queue requires the desktop launcher.' }),
  queueStop: async () => ({ cancelled: false }),
  queueGetStatus: async () => ({
    active: false,
    ip: null as string | null,
    port: null as string | null,
    sname: null as string | null,
    elapsed: 0
  }),
  onQueueStatus: (): (() => void) => () => {},
  onQueueJoined: (): (() => void) => () => {},
  onModSyncProgress: (): (() => void) => () => {}
}
