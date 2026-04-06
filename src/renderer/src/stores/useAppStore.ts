import { create } from 'zustand'
import type { AppConfig, AppPage, GamePaths } from '../../../shared/types'
import { useServerStore } from './useServerStore'

interface AppState {
  currentPage: AppPage
  config: AppConfig | null
  configLoaded: boolean
  sidebarCollapsed: boolean

  setPage: (page: AppPage) => void
  setConfig: (config: AppConfig) => void
  updateConfig: (partial: Partial<AppConfig>) => void
  toggleSidebar: () => void

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
