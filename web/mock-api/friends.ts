// Friends mock — backed by localStorage so adds/removes survive a reload.

interface Friend {
  id: string
  displayName: string
  addedAt: number
  notes?: string
  tags?: string[]
}

interface FriendSession {
  serverIdent: string
  serverName: string
  players: string[]
  timestamp: number
}

const FRIENDS_KEY = 'bmp-cm-demo:friends'
const SESSIONS_KEY = 'bmp-cm-demo:friend-sessions'

const SEED_FRIENDS: Friend[] = [
  { id: '12345', displayName: 'Anonym', addedAt: Date.now() - 86_400_000 * 7, tags: ['Drift'] },
  { id: '23456', displayName: 'BeamMaster', addedAt: Date.now() - 86_400_000 * 14, tags: ['Racing'] },
  { id: '34567', displayName: 'OffroadKing', addedAt: Date.now() - 86_400_000 * 30, notes: 'Met in West Coast freeroam.' }
]

const SEED_SESSIONS: FriendSession[] = [
  {
    serverIdent: '1.2.3.4:30814',
    serverName: 'Freeroam | West Coast USA | No Rules',
    players: ['Anonym', 'BeamMaster'],
    timestamp: Date.now() - 3_600_000
  },
  {
    serverIdent: '10.0.0.1:30814',
    serverName: 'Official BeamMP Freeroam',
    players: ['OffroadKing'],
    timestamp: Date.now() - 86_400_000 * 2
  }
]

function loadFriends(): Friend[] {
  try {
    const raw = localStorage.getItem(FRIENDS_KEY)
    if (!raw) {
      localStorage.setItem(FRIENDS_KEY, JSON.stringify(SEED_FRIENDS))
      return [...SEED_FRIENDS]
    }
    return JSON.parse(raw) as Friend[]
  } catch {
    return [...SEED_FRIENDS]
  }
}

function saveFriends(list: Friend[]): Friend[] {
  try { localStorage.setItem(FRIENDS_KEY, JSON.stringify(list)) } catch { /* quota */ }
  return list
}

function loadSessions(): FriendSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(SEED_SESSIONS))
      return [...SEED_SESSIONS]
    }
    return JSON.parse(raw) as FriendSession[]
  } catch {
    return [...SEED_SESSIONS]
  }
}

export const friendMocks = {
  getFriends: async (): Promise<Friend[]> => loadFriends(),

  addFriend: async (id: string, displayName: string): Promise<Friend[]> => {
    const friends = loadFriends()
    if (!friends.some((f) => f.id === id)) {
      friends.push({ id, displayName, addedAt: Date.now() })
    }
    return saveFriends(friends)
  },

  removeFriend: async (id: string): Promise<Friend[]> =>
    saveFriends(loadFriends().filter((f) => f.id !== id)),

  updateFriend: async (
    id: string,
    updates: { displayName?: string; notes?: string; tags?: string[] }
  ): Promise<Friend[]> => {
    const friends = loadFriends().map((f) => (f.id === id ? { ...f, ...updates } : f))
    return saveFriends(friends)
  },

  getFriendSessions: async (): Promise<FriendSession[]> => loadSessions(),

  recordFriendSession: async (
    serverIdent: string,
    serverName: string,
    players: string[]
  ): Promise<void> => {
    const sessions = loadSessions()
    sessions.unshift({ serverIdent, serverName, players, timestamp: Date.now() })
    try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 50))) } catch { /* quota */ }
  }
}
