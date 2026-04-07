import { create } from 'zustand'
import type { ServerInfo } from '../../../shared/types'

export interface Friend {
  id: string
  displayName: string
  addedAt: number
  notes?: string
  tags?: string[]
}

export interface FriendOnlineStatus {
  online: boolean
  serverName?: string
  serverIdent?: string
  serverMap?: string
  serverPlayers?: number
  serverMaxPlayers?: number
  lastSeen?: number
}

export interface SessionRecord {
  serverIdent: string
  serverName: string
  players: string[]
  timestamp: number
}

interface FriendsState {
  friends: Friend[]
  onlineStatus: Map<string, FriendOnlineStatus>
  sessions: SessionRecord[]
  suggestions: Array<{ name: string; seenCount: number; lastSeen: number }>
  loading: boolean
  searchQuery: string

  loadFriends: () => Promise<void>
  addFriend: (id: string, displayName: string) => Promise<void>
  removeFriend: (id: string) => Promise<void>
  updateFriend: (id: string, updates: { displayName?: string; notes?: string; tags?: string[] }) => Promise<void>
  loadSessions: () => Promise<void>
  refreshOnlineStatus: (servers: ServerInfo[]) => void
  computeSuggestions: () => void
  setSearchQuery: (query: string) => void
}

/** Strip BeamMP color codes (^0-^f, ^r, ^l, etc.) from player names */
function stripColorCodes(name: string): string {
  return name.replace(/\^[0-9a-fA-FlLrR]/g, '').trim()
}

export const useFriendsStore = create<FriendsState>((set, get) => ({
  friends: [],
  onlineStatus: new Map(),
  sessions: [],
  suggestions: [],
  loading: false,
  searchQuery: '',

  loadFriends: async () => {
    set({ loading: true })
    try {
      const friends = await window.api.getFriends()
      set({ friends })
    } catch (err) {
      console.error('Failed to load friends:', err)
    } finally {
      set({ loading: false })
    }
  },

  addFriend: async (id: string, displayName: string) => {
    const friends = await window.api.addFriend(id, displayName)
    set({ friends })
  },

  removeFriend: async (id: string) => {
    const friends = await window.api.removeFriend(id)
    set({ friends })
  },

  updateFriend: async (id: string, updates) => {
    const friends = await window.api.updateFriend(id, updates)
    set({ friends })
  },

  loadSessions: async () => {
    try {
      const sessions = await window.api.getFriendSessions()
      set({ sessions })
    } catch (err) {
      console.error('Failed to load sessions:', err)
    }
  },

  refreshOnlineStatus: (servers: ServerInfo[]) => {
    const { friends } = get()
    const friendIds = new Set(friends.map((f) => f.id.toLowerCase()))
    const statusMap = new Map<string, FriendOnlineStatus>()

    // Initialize all friends as offline
    for (const f of friends) {
      const existing = get().onlineStatus.get(f.id)
      statusMap.set(f.id, {
        online: false,
        lastSeen: existing?.lastSeen
      })
    }

    // Scan all servers for friends
    for (const server of servers) {
      if (!server.playerslist) continue
      const players = server.playerslist.split(';').map((p) => stripColorCodes(p)).filter(Boolean)
      for (const player of players) {
        if (friendIds.has(player.toLowerCase())) {
          // Find the matching friend (case-insensitive)
          const friend = friends.find((f) => f.id.toLowerCase() === player.toLowerCase())
          if (friend) {
            statusMap.set(friend.id, {
              online: true,
              serverName: server.sname,
              serverIdent: `${server.ip}:${server.port}`,
              serverMap: server.map,
              serverPlayers: parseInt(server.players, 10) || 0,
              serverMaxPlayers: parseInt(server.maxplayers, 10) || 0,
              lastSeen: Date.now()
            })
          }
        }
      }
    }

    set({ onlineStatus: statusMap })
  },

  computeSuggestions: () => {
    const { sessions, friends } = get()
    const friendIds = new Set(friends.map((f) => f.id.toLowerCase()))
    const playerCounts = new Map<string, { count: number; lastSeen: number }>()

    for (const session of sessions) {
      for (const player of session.players) {
        const clean = stripColorCodes(player)
        if (!clean || friendIds.has(clean.toLowerCase())) continue
        const existing = playerCounts.get(clean) || { count: 0, lastSeen: 0 }
        existing.count++
        existing.lastSeen = Math.max(existing.lastSeen, session.timestamp)
        playerCounts.set(clean, existing)
      }
    }

    // Only suggest players seen 2+ times, sorted by frequency
    const suggestions = [...playerCounts.entries()]
      .filter(([, v]) => v.count >= 2)
      .map(([name, v]) => ({ name, seenCount: v.count, lastSeen: v.lastSeen }))
      .sort((a, b) => b.seenCount - a.seenCount)
      .slice(0, 20)

    set({ suggestions })
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query })
  }
}))
