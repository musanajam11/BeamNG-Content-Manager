import { create } from 'zustand'
import type { GameStatus } from '../../../shared/types'

interface GameState {
  gameStatus: GameStatus
  launching: boolean
  error: string | null

  launchGame: () => Promise<void>
  killGame: () => Promise<void>
  refreshStatus: () => Promise<void>
}

export const useGameStore = create<GameState>((set) => ({
  gameStatus: { running: false, pid: null, connectedServer: null },
  launching: false,
  error: null,

  launchGame: async () => {
    set({ launching: true, error: null })
    try {
      const result = await window.api.launchGame()
      if (result.success) {
        set({ gameStatus: { running: true, pid: null, connectedServer: null }, launching: false })
      } else {
        set({ error: result.error || 'Failed to launch', launching: false })
      }
    } catch (err) {
      set({ error: (err as Error).message, launching: false })
    }
  },

  killGame: async () => {
    try {
      await window.api.killGame()
      set({ gameStatus: { running: false, pid: null, connectedServer: null } })
    } catch (err) {
      set({ error: (err as Error).message })
    }
  },

  refreshStatus: async () => {
    const gameStatus = await window.api.getGameStatus()
    set({ gameStatus })
  }
}))
