import { create } from 'zustand'
import type { LoadOrderData, ModConflictReport, ModConflict } from '../../../shared/types'

interface ModOrderState {
  /** Ordered array of mod keys (enabled mods only) */
  loadOrder: string[]
  /** Whether filesystem enforcement is active */
  enforcement: boolean
  /** Cached conflict report (null = not scanned yet) */
  conflictReport: ModConflictReport | null
  /** Loading state for conflict scan */
  scanningConflicts: boolean

  // Actions
  fetchLoadOrder: () => Promise<void>
  setLoadOrder: (orderedKeys: string[]) => Promise<void>
  setEnforcement: (enabled: boolean) => Promise<void>
  scanConflicts: () => Promise<void>
  getModConflicts: (modKey: string) => ModConflict[]
  getModConflictCount: (modKey: string) => number
  isModOverridden: (modKey: string) => boolean
}

export const useModOrderStore = create<ModOrderState>((set, get) => ({
  loadOrder: [],
  enforcement: false,
  conflictReport: null,
  scanningConflicts: false,

  fetchLoadOrder: async () => {
    try {
      const [orderResult, config] = await Promise.all([
        window.api.getModLoadOrder(),
        window.api.getConfig()
      ])
      if (orderResult.success && orderResult.data) {
        const data = orderResult.data as LoadOrderData
        // Convert orders map to sorted array
        const sorted = Object.entries(data.orders)
          .sort(([, a], [, b]) => a - b)
          .map(([key]) => key)
        set({ loadOrder: sorted })
      }
      if (config) {
        set({ enforcement: config.loadOrderEnforcement ?? false })
      }
    } catch {
      // ignore
    }
  },

  setLoadOrder: async (orderedKeys: string[]) => {
    set({ loadOrder: orderedKeys })
    try {
      await window.api.setModLoadOrder(orderedKeys)
    } catch {
      // ignore
    }
  },

  setEnforcement: async (enabled: boolean) => {
    set({ enforcement: enabled })
    try {
      await window.api.toggleLoadOrderEnforcement(enabled)
    } catch {
      // revert on failure
      set({ enforcement: !enabled })
    }
  },

  scanConflicts: async () => {
    set({ scanningConflicts: true })
    try {
      const result = await window.api.scanModConflicts()
      if (result.success && result.data) {
        set({ conflictReport: result.data })
      }
    } catch {
      // ignore
    } finally {
      set({ scanningConflicts: false })
    }
  },

  getModConflicts: (modKey: string) => {
    const report = get().conflictReport
    if (!report) return []
    return report.conflicts.filter((c) =>
      c.mods.some((m) => m.modKey === modKey)
    )
  },

  getModConflictCount: (modKey: string) => {
    return get().getModConflicts(modKey).length
  },

  isModOverridden: (modKey: string) => {
    const conflicts = get().getModConflicts(modKey)
    // Mod is "overridden" if there are conflicts where it does NOT win
    return conflicts.some((c) => c.winner !== modKey && c.mods.some((m) => m.modKey === modKey))
  }
}))
