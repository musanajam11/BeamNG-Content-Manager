import { create } from 'zustand'
import type {
  InputDevice,
  InputAction,
  ActionCategory,
  InputBinding,
  MergedDeviceBindings,
  SteeringFilterSettings,
  ControlsTab,
  ControlsPreset,
  FFBConfig,
  BindingConflict
} from '../../../shared/types'

interface ControlsState {
  /* ── Data ── */
  devices: InputDevice[]
  actions: InputAction[]
  categories: ActionCategory[]
  selectedDevice: string | null
  bindings: InputBinding[]
  steeringSettings: SteeringFilterSettings | null
  presets: ControlsPreset[]
  tab: ControlsTab
  search: string
  loading: boolean
  error: string | null

  /* ── Actions ── */
  refresh: () => Promise<void>
  selectDevice: (fileName: string) => Promise<void>
  setTab: (tab: ControlsTab) => void
  setSearch: (q: string) => void

  /* Binding CRUD */
  setBinding: (binding: InputBinding) => Promise<void>
  removeBinding: (control: string, action: string) => Promise<void>
  resetDevice: () => Promise<void>

  /* FFB */
  setFFBConfig: (control: string, ffb: FFBConfig) => Promise<void>

  /* Steering */
  loadSteeringSettings: () => Promise<void>
  updateSteeringSettings: (settings: Partial<SteeringFilterSettings>) => Promise<void>

  /* Presets */
  loadPresets: () => Promise<void>
  savePreset: (name: string) => Promise<void>
  applyPreset: (presetId: string) => Promise<void>
  deletePreset: (presetId: string) => Promise<void>
  exportPreset: (presetId: string) => Promise<ControlsPreset | null>
  importPreset: (jsonString: string) => Promise<void>

  /* Conflict detection */
  getConflicts: (control: string, newAction: string) => BindingConflict | null
}

export const useControlsStore = create<ControlsState>((set, get) => ({
  devices: [],
  actions: [],
  categories: [],
  selectedDevice: null,
  bindings: [],
  steeringSettings: null,
  presets: [],
  tab: 'bindings',
  search: '',
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null })
    try {
      const [devices, actions, categories] = await Promise.all([
        window.api.controlsGetDevices(),
        window.api.controlsGetActions(),
        window.api.controlsGetCategories()
      ])
      set({ devices, actions, categories, loading: false })

      // If a device was selected, refresh its bindings too
      const { selectedDevice } = get()
      if (selectedDevice) {
        const merged = await window.api.controlsGetBindings(selectedDevice)
        if (merged) {
          set({ bindings: merged.bindings })
        }
      }
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },

  selectDevice: async (fileName: string) => {
    set({ selectedDevice: fileName, loading: true, error: null })
    try {
      const merged = await window.api.controlsGetBindings(fileName)
      if (merged) {
        set({ bindings: merged.bindings, loading: false })
      } else {
        set({ bindings: [], loading: false, error: 'Device not found' })
      }
    } catch (err) {
      set({ bindings: [], error: String(err), loading: false })
    }
  },

  setTab: (tab) => set({ tab }),
  setSearch: (search) => set({ search }),

  setBinding: async (binding) => {
    const { selectedDevice } = get()
    if (!selectedDevice) return
    try {
      const merged = await window.api.controlsSetBinding(selectedDevice, binding)
      set({ bindings: merged.bindings })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  removeBinding: async (control, action) => {
    const { selectedDevice } = get()
    if (!selectedDevice) return
    try {
      const merged = await window.api.controlsRemoveBinding(selectedDevice, control, action)
      set({ bindings: merged.bindings })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  resetDevice: async () => {
    const { selectedDevice } = get()
    if (!selectedDevice) return
    try {
      await window.api.controlsResetDevice(selectedDevice)
      // Reload bindings from defaults
      const merged = await window.api.controlsGetBindings(selectedDevice)
      if (merged) {
        set({ bindings: merged.bindings })
      }
      // Refresh device list (hasUserOverrides flag changed)
      const devices = await window.api.controlsGetDevices()
      set({ devices })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  setFFBConfig: async (control, ffb) => {
    const { selectedDevice } = get()
    if (!selectedDevice) return
    try {
      const merged = await window.api.controlsSetFFBConfig(selectedDevice, control, ffb)
      set({ bindings: merged.bindings })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  loadSteeringSettings: async () => {
    try {
      const settings = await window.api.controlsGetSteeringSettings()
      set({ steeringSettings: settings })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  updateSteeringSettings: async (settings) => {
    try {
      const updated = await window.api.controlsSetSteeringSettings(settings)
      set({ steeringSettings: updated })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  loadPresets: async () => {
    try {
      const presets = await window.api.controlsListPresets()
      set({ presets })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  savePreset: async (name) => {
    const { selectedDevice, devices } = get()
    if (!selectedDevice) return
    const device = devices.find((d) => d.fileName === selectedDevice)
    if (!device) return
    try {
      await window.api.controlsSavePreset(name, selectedDevice, device)
      const presets = await window.api.controlsListPresets()
      set({ presets })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  applyPreset: async (presetId) => {
    const { selectedDevice } = get()
    try {
      await window.api.controlsLoadPreset(presetId)
      // Reload bindings after applying preset
      if (selectedDevice) {
        const merged = await window.api.controlsGetBindings(selectedDevice)
        if (merged) {
          set({ bindings: merged.bindings })
        }
      }
      // Refresh device list (hasUserOverrides flag changed)
      const devices = await window.api.controlsGetDevices()
      set({ devices })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  deletePreset: async (presetId) => {
    try {
      await window.api.controlsDeletePreset(presetId)
      const presets = await window.api.controlsListPresets()
      set({ presets })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  exportPreset: async (presetId) => {
    try {
      return await window.api.controlsExportPreset(presetId)
    } catch (err) {
      set({ error: String(err) })
      return null
    }
  },

  importPreset: async (jsonString) => {
    try {
      await window.api.controlsImportPreset(jsonString)
      const presets = await window.api.controlsListPresets()
      set({ presets })
    } catch (err) {
      set({ error: String(err) })
    }
  },

  getConflicts: (control, newAction) => {
    const { bindings } = get()
    const conflicting = bindings
      .filter((b) => b.control === control && b.action !== newAction && !b.isRemoved)
      .map((b) => b.action)

    if (conflicting.length === 0) return null

    return {
      control,
      existingActions: conflicting,
      newAction
    }
  }
}))
