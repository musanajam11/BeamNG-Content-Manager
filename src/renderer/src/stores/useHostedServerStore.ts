import { create } from 'zustand'
import type {
  HostedServerConfig,
  HostedServerStatus,
  HostedServerEntry,
  ServerFileEntry,
  ServerExeStatus
} from '../../../shared/types'
import { useToastStore } from './useToastStore'

export type Tab = 'status' | 'config' | 'console' | 'files' | 'mods' | 'heatmap' | 'schedule' | 'analytics'
type ViewMode = 'grid' | 'detail'

interface HostedServerState {
  /* ── Data ── */
  servers: HostedServerEntry[]
  selectedId: string | null
  tab: Tab
  viewMode: ViewMode
  exeStatus: ServerExeStatus

  /* Console */
  consoleLines: string[]
  cmdInput: string

  /* Config draft */
  draft: Partial<HostedServerConfig>
  saving: boolean

  /* Files */
  files: ServerFileEntry[]
  filePath: string

  /* Mods */
  mods: { key: string; name: string; active: boolean; filePath: string; multiplayerScope?: string | null }[]

  /* Confirm dialog */
  confirmDialog: {
    open: boolean
    title: string
    message: string
    variant: 'danger' | 'warning' | 'default'
    onConfirm: () => void
  }

  /* ── Computed ── */
  selected: HostedServerEntry | null

  /* ── Actions ── */
  refresh: () => Promise<void>
  select: (id: string) => void
  openDetail: (id: string, tab?: Tab) => void
  backToGrid: () => void
  setTab: (tab: Tab) => void
  setCmdInput: (v: string) => void
  setDraft: (d: Partial<HostedServerConfig>) => void
  setFilePath: (p: string) => void

  /* Server CRUD */
  createServer: () => Promise<void>
  duplicateServer: (id: string) => Promise<void>
  deleteServer: (id: string) => Promise<void>
  confirmDeleteServer: (id: string, name: string) => void
  saveConfig: () => Promise<void>

  /* Lifecycle */
  startServer: (id: string) => Promise<void>
  stopServer: (id: string) => Promise<void>
  restartServer: (id: string) => Promise<void>
  startAll: () => Promise<void>
  stopAll: () => Promise<void>

  /* Console */
  loadConsole: (id: string) => Promise<void>
  sendCommand: () => void
  appendConsoleLines: (serverId: string, lines: string[]) => void
  clearConsole: () => void

  /* Files */
  loadFiles: (id: string, sub: string) => Promise<void>

  /* Mods */
  loadMods: () => Promise<void>

  /* Exe */
  browseExe: () => Promise<void>
  downloadExe: () => Promise<void>
  installExe: (path: string) => Promise<void>

  /* Status updates from IPC */
  updateServerStatus: (status: HostedServerStatus) => void

  /* Dialog */
  closeConfirmDialog: () => void
}

const EMPTY_CONFIRM = {
  open: false,
  title: '',
  message: '',
  variant: 'default' as const,
  onConfirm: () => {}
}

export const useHostedServerStore = create<HostedServerState>((set, get) => ({
  servers: [],
  selectedId: null,
  tab: 'status',
  viewMode: 'grid',
  exeStatus: 'missing',
  consoleLines: [],
  cmdInput: '',
  draft: {},
  saving: false,
  files: [],
  filePath: '',
  mods: [],
  confirmDialog: { ...EMPTY_CONFIRM },
  selected: null,

  /* ── Actions ── */

  refresh: async () => {
    const list = await window.api.hostedServerList()
    const status = await window.api.hostedServerGetExeStatus()
    const { selectedId } = get()
    set({
      servers: list,
      exeStatus: status as ServerExeStatus,
      selected: list.find((s) => s.config.id === selectedId) ?? null
    })
  },

  select: (id) => {
    const { servers } = get()
    const entry = servers.find((s) => s.config.id === id) ?? null
    set({
      selectedId: id,
      tab: 'status',
      filePath: '',
      selected: entry,
      draft: entry ? { ...entry.config } : {}
    })
    get().loadConsole(id)
    get().loadFiles(id, '')
    get().loadMods()
  },

  openDetail: (id, tab) => {
    get().select(id)
    if (tab) set({ tab })
    set({ viewMode: 'detail' })
  },

  backToGrid: () => {
    set({ viewMode: 'grid', selectedId: null, selected: null })
  },

  setTab: (tab) => set({ tab }),
  setCmdInput: (v) => set({ cmdInput: v }),
  setDraft: (d) => set({ draft: d }),
  setFilePath: (p) => set({ filePath: p }),

  /* ── CRUD ── */

  createServer: async () => {
    const cfg = await window.api.hostedServerCreate()
    await get().refresh()
    get().select(cfg.id)
    useToastStore.getState().addToast('Server instance created', 'success')
  },

  duplicateServer: async (id) => {
    const { servers } = get()
    const source = servers.find((s) => s.config.id === id)
    if (!source) return
    const { id: _id, ...rest } = source.config
    const cfg = await window.api.hostedServerCreate({ ...rest, name: `${source.config.name} (Copy)`, port: source.config.port + 1 })
    await get().refresh()
    get().openDetail(cfg.id)
    useToastStore.getState().addToast(`Cloned "${source.config.name}"`, 'success')
  },

  deleteServer: async (id) => {
    await window.api.hostedServerDelete(id)
    const { selectedId } = get()
    if (selectedId === id) set({ selectedId: null, selected: null, viewMode: 'grid' })
    await get().refresh()
    set({ confirmDialog: { ...EMPTY_CONFIRM } })
    useToastStore.getState().addToast('Server deleted', 'info')
  },

  confirmDeleteServer: (id, name) => {
    set({
      confirmDialog: {
        open: true,
        title: 'Delete Server',
        message: `Are you sure you want to delete "${name}"? This will remove all server files and cannot be undone.`,
        variant: 'danger',
        onConfirm: () => get().deleteServer(id)
      }
    })
  },

  saveConfig: async () => {
    const { selectedId, draft } = get()
    if (!selectedId || !draft) return
    set({ saving: true })
    try {
      await window.api.hostedServerUpdate(selectedId, draft)
      await get().refresh()
      useToastStore.getState().addToast('Configuration saved', 'success')
    } catch {
      useToastStore.getState().addToast('Failed to save configuration', 'error')
    } finally {
      set({ saving: false })
    }
  },

  /* ── Lifecycle ── */

  startServer: async (id) => {
    const result = await window.api.hostedServerStart(id)
    if (result.success) {
      set({ tab: 'console' })
      get().loadConsole(id)
      useToastStore.getState().addToast('Server starting...', 'info')
    } else {
      useToastStore.getState().addToast(result.error ?? 'Failed to start server', 'error')
    }
  },

  stopServer: async (id) => {
    await window.api.hostedServerStop(id)
    useToastStore.getState().addToast('Server stopped', 'info')
  },

  restartServer: async (id) => {
    const result = await window.api.hostedServerRestart(id)
    if (result.success) {
      set({ tab: 'console' })
      useToastStore.getState().addToast('Server restarting...', 'info')
    } else {
      useToastStore.getState().addToast(result.error ?? 'Failed to restart', 'error')
    }
  },

  startAll: async () => {
    const { servers } = get()
    const stopped = servers.filter(
      (s) => s.status.state === 'stopped' || s.status.state === 'error'
    )
    await Promise.all(stopped.map((s) => window.api.hostedServerStart(s.config.id)))
  },

  stopAll: async () => {
    const { servers } = get()
    const running = servers.filter(
      (s) => s.status.state === 'running' || s.status.state === 'starting'
    )
    await Promise.all(running.map((s) => window.api.hostedServerStop(s.config.id)))
  },

  /* ── Console ── */

  loadConsole: async (id) => {
    const lines = await window.api.hostedServerGetConsole(id)
    set({ consoleLines: lines })
  },

  sendCommand: () => {
    const { selectedId, cmdInput } = get()
    if (!selectedId || !cmdInput.trim()) return
    window.api.hostedServerSendCommand(selectedId, cmdInput.trim())
    set({ cmdInput: '' })
  },

  appendConsoleLines: (serverId, lines) => {
    const { selectedId } = get()
    if (serverId !== selectedId) return
    set((state) => {
      const combined = [...state.consoleLines, ...lines]
      return { consoleLines: combined.length > 2000 ? combined.slice(-2000) : combined }
    })
  },

  clearConsole: () => set({ consoleLines: [] }),

  /* ── Files ── */

  loadFiles: async (id, sub) => {
    const entries = await window.api.hostedServerListFiles(id, sub)
    set({ files: entries, filePath: sub })
  },

  /* ── Mods ── */

  loadMods: async () => {
    const result = await window.api.getMods()
    if (result.success && result.data) {
      set({
        mods: result.data
          .filter((m) => m.location !== 'multiplayer')
          .map((m) => ({
            key: m.key,
            name: m.title ?? m.fileName,
            active: m.enabled,
            filePath: m.filePath,
            multiplayerScope: m.multiplayerScope
          }))
      })
    }
  },

  /* ── Exe ── */

  browseExe: async () => {
    const path = await window.api.hostedServerBrowseExe()
    if (path) {
      const status = await window.api.hostedServerGetExeStatus()
      set({ exeStatus: status as ServerExeStatus })
    }
  },

  downloadExe: async () => {
    set({ exeStatus: 'downloading' })
    const result = await window.api.hostedServerDownloadExe()
    if (!result.success) {
      set({ exeStatus: 'missing' })
    } else {
      const status = await window.api.hostedServerGetExeStatus()
      set({ exeStatus: status as ServerExeStatus })
    }
  },

  installExe: async (sourcePath) => {
    await window.api.hostedServerInstallExe(sourcePath)
    const status = await window.api.hostedServerGetExeStatus()
    set({ exeStatus: status as ServerExeStatus })
  },

  /* ── Status from IPC ── */

  updateServerStatus: (status) => {
    set((state) => {
      const servers = state.servers.map((s) =>
        s.config.id === status.id ? { ...s, status } : s
      )
      return {
        servers,
        selected:
          state.selectedId === status.id
            ? servers.find((s) => s.config.id === status.id) ?? null
            : state.selected
      }
    })
  },

  /* ── Dialog ── */

  closeConfirmDialog: () => set({ confirmDialog: { ...EMPTY_CONFIRM } })
}))
