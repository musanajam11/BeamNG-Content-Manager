import { create } from 'zustand'
import type { AppConfig, AppPage, GamePaths } from '../../../shared/types'
import { useServerStore } from './useServerStore'

interface AppState {
  currentPage: AppPage
  config: AppConfig | null
  configLoaded: boolean
  sidebarCollapsed: boolean

  // Auto-updater state (persists across page navigation)
  updateAvailable: { version: string } | null
  updateProgress: number | null
  updateReady: string | null

  setPage: (page: AppPage) => void
  setConfig: (config: AppConfig) => void
  updateConfig: (partial: Partial<AppConfig>) => void
  toggleSidebar: () => void

  setUpdateAvailable: (info: { version: string } | null) => void
  setUpdateProgress: (percent: number | null) => void
  setUpdateReady: (version: string | null) => void

  loadConfig: () => Promise<void>
  saveConfig: (partial: Partial<AppConfig>) => Promise<void>
  setGamePaths: (installDir: string, userDir: string) => Promise<void>
  markSetupComplete: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  currentPage: 'home',
  config: null,
  configLoaded: false,
  sidebarCollapsed: false,

  updateAvailable: null,
  updateProgress: null,
  updateReady: null,

  setPage: (page) => {
    set({ currentPage: page })
    if (page !== 'servers') {
      useServerStore.getState().selectServer(null)
    }
  },
  setConfig: (config) => set({ config, configLoaded: true }),
  updateConfig: (partial) =>
    set((state) => ({
      config: state.config ? { ...state.config, ...partial } : null
    })),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setUpdateAvailable: (info) => set({ updateAvailable: info }),
  setUpdateProgress: (percent) => set({ updateProgress: percent }),
  setUpdateReady: (version) => set({ updateReady: version, updateProgress: null }),

  loadConfig: async () => {
    const config = await window.api.getConfig()
    set({ config, configLoaded: true })
  },

  saveConfig: async (partial) => {
    await window.api.updateConfig(partial)
    get().updateConfig(partial)
  },

  setGamePaths: async (installDir, userDir) => {
    const paths: GamePaths = await window.api.setCustomPaths(installDir, userDir)
    get().updateConfig({ gamePaths: paths })
  },

  markSetupComplete: async () => {
    await window.api.markSetupComplete()
    get().updateConfig({ setupComplete: true })
  }
}))
