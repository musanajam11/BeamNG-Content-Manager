// Hosted-server mock for the web demo. Provides a fully interactive
// "pretend" server lifecycle backed by localStorage so users can create,
// edit, start, stop and explore servers without a real BeamMP executable.
//
// Return shapes mirror the real preload signatures exactly — see
// src/preload/index.ts (hostedServer*) and src/shared/types.ts for the
// canonical types referenced here.

import type {
  HostedServerConfig,
  HostedServerEntry,
  HostedServerStatus,
  HostedServerState as ServerState,
  ServerExeStatus,
  ServerFileEntry
} from '../../src/shared/types'

const SERVERS_KEY = 'bmp-cm-demo:hosted-servers'
const CONSOLE_KEY_PREFIX = 'bmp-cm-demo:hosted-console:'
const CUSTOM_IMAGE_PREFIX = 'bmp-cm-demo:hosted-image:'

// ── Persistence ──────────────────────────────────────────────────────────

interface StoredServer {
  config: HostedServerConfig
  // We don't persist runtime status — it's reset per session.
}

function loadStored(): StoredServer[] {
  try {
    const raw = localStorage.getItem(SERVERS_KEY)
    if (raw) return JSON.parse(raw) as StoredServer[]
  } catch { /* fall through */ }
  // Seed with one server so the page isn't empty on first visit.
  return [{ config: makeDefaultConfig('demo-srv-1', 'My Demo Server', 30814) }]
}

function saveStored(list: StoredServer[]): void {
  try { localStorage.setItem(SERVERS_KEY, JSON.stringify(list)) } catch { /* quota */ }
}

function makeDefaultConfig(id: string, name: string, port: number): HostedServerConfig {
  return {
    id,
    name,
    port,
    authKey: 'XXXX-DEMO-XXXX-' + id.slice(-4).toUpperCase(),
    maxPlayers: 16,
    maxCars: 1,
    map: '/levels/west_coast_usa/info.json',
    private: false,
    description: 'A pretend server you can configure and explore.',
    resourceFolder: 'Resources',
    tags: 'Freeroam,Demo',
    allowGuests: true,
    logChat: true,
    debug: false,
    clientContentGate: false
  }
}

// ── In-memory runtime state (per page load) ──────────────────────────────

const runtime = new Map<string, HostedServerStatus>()
const consoleListeners = new Set<(data: { serverId: string; lines: string[] }) => void>()
const statusListeners = new Set<(status: HostedServerStatus) => void>()
const startedAt = new Map<string, number>()
const tickTimers = new Map<string, number>()

function freshStatus(id: string, state: ServerState = 'stopped'): HostedServerStatus {
  return {
    id,
    state,
    pid: state === 'running' ? Math.floor(1000 + Math.random() * 9000) : null,
    uptimeMs: 0,
    startedAt: state === 'running' ? Date.now() : null,
    players: 0,
    error: null,
    memoryBytes: 0,
    cpuPercent: 0,
    totalMemoryBytes: 16 * 1024 * 1024 * 1024
  }
}

function getStatus(id: string): HostedServerStatus {
  let s = runtime.get(id)
  if (!s) { s = freshStatus(id); runtime.set(id, s) }
  return s
}

function emitStatus(s: HostedServerStatus): void {
  for (const l of statusListeners) { try { l(s) } catch { /* ignore */ } }
}

function appendConsole(serverId: string, lines: string[]): void {
  try {
    const key = CONSOLE_KEY_PREFIX + serverId
    const existing: string[] = JSON.parse(localStorage.getItem(key) || '[]')
    const next = [...existing, ...lines].slice(-500)
    localStorage.setItem(key, JSON.stringify(next))
  } catch { /* quota */ }
  for (const l of consoleListeners) { try { l({ serverId, lines }) } catch { /* ignore */ } }
}

function loadConsole(serverId: string): string[] {
  try { return JSON.parse(localStorage.getItem(CONSOLE_KEY_PREFIX + serverId) || '[]') } catch { return [] }
}

function clearConsole(serverId: string): void {
  try { localStorage.removeItem(CONSOLE_KEY_PREFIX + serverId) } catch { /* */ }
}

function entriesFromStored(): HostedServerEntry[] {
  return loadStored().map(({ config }) => ({ config, status: getStatus(config.id) }))
}

// ── Simulated server lifecycle ───────────────────────────────────────────

const FAKE_PLAYER_NAMES = ['Anonym', 'BeamMaster', 'OffroadKing', 'DriftChamp', 'TruckLover', 'MapMaker']

function tickRunningServer(id: string): void {
  const s = getStatus(id)
  if (s.state !== 'running') return
  const start = startedAt.get(id) ?? Date.now()
  s.uptimeMs = Date.now() - start
  s.cpuPercent = Math.max(2, Math.min(35, s.cpuPercent + (Math.random() * 6 - 3)))
  s.memoryBytes = Math.floor(180_000_000 + Math.random() * 40_000_000)
  // Slowly drift player count between 0 and maxPlayers.
  const cfg = loadStored().find((x) => x.config.id === id)?.config
  const cap = cfg?.maxPlayers ?? 8
  if (Math.random() < 0.12) s.players = Math.max(0, Math.min(cap, s.players + (Math.random() < 0.5 ? -1 : 1)))
  emitStatus(s)
  // Occasional console chatter.
  if (Math.random() < 0.18) {
    const who = FAKE_PLAYER_NAMES[Math.floor(Math.random() * FAKE_PLAYER_NAMES.length)]
    const events = [
      `[INFO] Heartbeat OK`,
      `[INFO] ${who} drove ${(Math.random() * 200).toFixed(1)}m`,
      `[INFO] Auto-saved server state`,
      `[DEBUG] Sync packet broadcast (${Math.floor(Math.random() * 80)} bytes)`
    ]
    appendConsole(id, [events[Math.floor(Math.random() * events.length)]])
  }
}

function startSimulation(id: string): void {
  if (tickTimers.has(id)) return
  const handle = window.setInterval(() => tickRunningServer(id), 1500)
  tickTimers.set(id, handle)
}

function stopSimulation(id: string): void {
  const h = tickTimers.get(id)
  if (h !== undefined) { window.clearInterval(h); tickTimers.delete(id) }
}

// ── File-tree mock (per-server localStorage tree) ────────────────────────

interface FakeFile { isDir: boolean; size: number; modified: number }
type FakeFs = Record<string, FakeFile>

function fsKey(serverId: string): string { return `bmp-cm-demo:hosted-fs:${serverId}` }

function loadFs(serverId: string): FakeFs {
  try {
    const raw = localStorage.getItem(fsKey(serverId))
    if (raw) return JSON.parse(raw) as FakeFs
  } catch { /* */ }
  const now = Date.now()
  const fs: FakeFs = {
    'ServerConfig.toml': { isDir: false, size: 1024, modified: now },
    'Resources': { isDir: true, size: 0, modified: now },
    'Resources/Server': { isDir: true, size: 0, modified: now },
    'Resources/Client': { isDir: true, size: 0, modified: now },
    'logs': { isDir: true, size: 0, modified: now },
    'logs/server.log': { isDir: false, size: 4096, modified: now }
  }
  try { localStorage.setItem(fsKey(serverId), JSON.stringify(fs)) } catch { /* */ }
  return fs
}

function listFiles(serverId: string, sub: string): ServerFileEntry[] {
  const fs = loadFs(serverId)
  const prefix = sub ? sub.replace(/\/+$/, '') + '/' : ''
  const out: ServerFileEntry[] = []
  for (const [path, info] of Object.entries(fs)) {
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    if (!rest || rest.includes('/')) continue
    out.push({
      name: rest,
      path,
      isDirectory: info.isDir,
      size: info.size,
      modified: info.modified
    })
  }
  out.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
  return out
}

// ── Helpers ──────────────────────────────────────────────────────────────

function findServer(id: string): StoredServer | undefined {
  return loadStored().find((s) => s.config.id === id)
}

function nextPort(existing: HostedServerConfig[]): number {
  let p = 30814
  const used = new Set(existing.map((s) => s.port))
  while (used.has(p)) p++
  return p
}

function randomId(): string {
  return 'srv-' + Math.random().toString(36).slice(2, 10)
}

const fail = (msg = 'Demo mode'): { success: false; error: string } => ({ success: false, error: msg })
const ok = <T,>(v: T): { success: true; data: T } => ({ success: true, data: v })

// ── Public API ───────────────────────────────────────────────────────────

export const hostedServerMocks = {
  // ── Lifecycle / CRUD (real preload returns plain values, not envelopes) ──
  hostedServerList: async (): Promise<HostedServerEntry[]> => entriesFromStored(),

  hostedServerCreate: async (partial?: Partial<HostedServerConfig>): Promise<HostedServerConfig> => {
    const list = loadStored()
    const id = randomId()
    const port = partial?.port ?? nextPort(list.map((s) => s.config))
    const cfg: HostedServerConfig = {
      ...makeDefaultConfig(id, partial?.name ?? `New Server ${list.length + 1}`, port),
      ...partial,
      id // never let partial override id
    }
    list.push({ config: cfg })
    saveStored(list)
    appendConsole(id, [
      `[INFO] Pretend BeamMP server created (web demo)`,
      `[INFO] Listening on 0.0.0.0:${cfg.port}`,
      `[INFO] Map: ${cfg.map}`
    ])
    return cfg
  },

  hostedServerUpdate: async (id: string, partial: Partial<HostedServerConfig>): Promise<HostedServerConfig | null> => {
    const list = loadStored()
    const idx = list.findIndex((s) => s.config.id === id)
    if (idx < 0) return null
    list[idx].config = { ...list[idx].config, ...partial, id }
    saveStored(list)
    appendConsole(id, [`[INFO] Configuration updated (web demo)`])
    return list[idx].config
  },

  hostedServerDelete: async (id: string): Promise<void> => {
    const list = loadStored().filter((s) => s.config.id !== id)
    saveStored(list)
    stopSimulation(id)
    runtime.delete(id)
    clearConsole(id)
    try {
      localStorage.removeItem(fsKey(id))
      localStorage.removeItem(CUSTOM_IMAGE_PREFIX + id)
    } catch { /* */ }
  },

  hostedServerStart: async (id: string): Promise<{ success: boolean; error?: string }> => {
    if (!findServer(id)) return fail('Server not found')
    const s = getStatus(id)
    s.state = 'running'
    s.pid = Math.floor(1000 + Math.random() * 9000)
    s.startedAt = Date.now()
    s.error = null
    s.players = 0
    startedAt.set(id, Date.now())
    runtime.set(id, s)
    appendConsole(id, [
      `[INFO] Starting BeamMP server (pretend)…`,
      `[INFO] PID ${s.pid}`,
      `[INFO] Server is online — players may join.`
    ])
    emitStatus(s)
    startSimulation(id)
    return { success: true }
  },

  hostedServerStop: async (id: string): Promise<{ success: boolean; error?: string }> => {
    const s = getStatus(id)
    s.state = 'stopped'
    s.pid = null
    s.startedAt = null
    s.uptimeMs = 0
    s.players = 0
    s.cpuPercent = 0
    s.memoryBytes = 0
    runtime.set(id, s)
    stopSimulation(id)
    appendConsole(id, [`[INFO] Server stopped.`])
    emitStatus(s)
    return { success: true }
  },

  hostedServerRestart: async (id: string): Promise<{ success: boolean; error?: string }> => {
    await hostedServerMocks.hostedServerStop(id)
    return hostedServerMocks.hostedServerStart(id)
  },

  // ── Exe management ──
  // Real signature returns ServerExeStatus = 'ready' | 'missing' | 'downloading'.
  // Returning 'ready' so the start/restart guard in useHostedServerStore lets users click Start.
  hostedServerGetExeStatus: async (): Promise<ServerExeStatus> => 'ready',
  hostedServerDownloadExe: async (): Promise<{ success: boolean; error?: string }> =>
    ({ success: true }),
  hostedServerInstallExe: async (): Promise<string> => 'C:/Demo/BeamMPServer/BeamMP-Server.exe',
  hostedServerBrowseExe: async (): Promise<string | null> => null,

  // ── Console ──
  hostedServerGetConsole: async (id: string): Promise<string[]> => loadConsole(id),
  hostedServerSendCommand: async (id: string, command: string): Promise<void> => {
    appendConsole(id, [`> ${command}`, `[INFO] Command acknowledged (demo mode — no real execution)`])
  },
  onHostedServerConsole: (cb: (data: { serverId: string; lines: string[] }) => void): (() => void) => {
    consoleListeners.add(cb)
    return () => consoleListeners.delete(cb)
  },
  onHostedServerStatusChange: (cb: (status: HostedServerStatus) => void): (() => void) => {
    statusListeners.add(cb)
    return () => statusListeners.delete(cb)
  },
  // Real signature passes the string status. Renderer wraps in setState directly.
  onHostedServerExeStatus: (_cb: (status: ServerExeStatus) => void): (() => void) => () => {},

  // ── Files ── (renderer expects ServerFileEntry[] directly, not an envelope)
  hostedServerListFiles: async (id: string, sub?: string): Promise<ServerFileEntry[]> =>
    listFiles(id, sub ?? ''),
  hostedServerSearchFiles: async (): Promise<ServerFileEntry[]> => [],
  hostedServerReadFile: async (): Promise<string> => '# Demo content — file editing is read-only here.\n',
  hostedServerWriteFile: async () => fail('Editing files requires the desktop app.'),
  hostedServerExtractZip: async () => fail(),
  hostedServerDeleteFile: async (id: string, filePath: string): Promise<void> => {
    try {
      const fs = loadFs(id)
      delete fs[filePath]
      localStorage.setItem(fsKey(id), JSON.stringify(fs))
    } catch { /* */ }
  },
  hostedServerCreateFolder: async (id: string, folderPath: string): Promise<void> => {
    try {
      const fs = loadFs(id)
      fs[folderPath] = { isDir: true, size: 0, modified: Date.now() }
      localStorage.setItem(fsKey(id), JSON.stringify(fs))
    } catch { /* */ }
  },
  hostedServerCopyMod: async () => fail(),
  hostedServerAddFiles: async (): Promise<string[]> => [],
  hostedServerUploadFiles: async (): Promise<string[]> => [],
  hostedServerRenameFile: async () => fail(),
  hostedServerDuplicateFile: async (): Promise<string | null> => null,
  hostedServerZipEntry: async () => fail(),
  hostedServerRevealInExplorer: async () => fail('Explorer access only available in the desktop app.'),
  hostedServerOpenEntry: async () => fail(),
  hostedServerDownloadEntry: async () => fail(),
  hostedServerTestPort: async (port: number): Promise<{ open: boolean; ip?: string; error?: string }> =>
    ({ open: true, ip: 'demo.local:' + port }),

  // ── Custom image ──
  hostedServerSaveCustomImage: async (id: string, dataUrl: string): Promise<string> => {
    try { localStorage.setItem(CUSTOM_IMAGE_PREFIX + id, dataUrl) } catch { /* quota */ }
    return dataUrl
  },
  hostedServerRemoveCustomImage: async (id: string): Promise<void> => {
    try { localStorage.removeItem(CUSTOM_IMAGE_PREFIX + id) } catch { /* */ }
  },
  hostedServerGetCustomImage: async (id: string): Promise<string | null> => {
    try { return localStorage.getItem(CUSTOM_IMAGE_PREFIX + id) } catch { return null }
  },

  // ── Routes / heatmap ──
  hostedServerGetRoutes: async (): Promise<unknown[]> => [],
  hostedServerSaveRoute: async () => fail(),
  hostedServerDeleteRoute: async () => fail(),
  hostedServerGetPlayerPositions: async (): Promise<unknown[]> => [],

  // ── Trackers / voice / ban plugins ──
  hostedServerDeployTracker: async () => fail(),
  hostedServerIsTrackerDeployed: async (): Promise<boolean> => false,
  hostedServerUndeployTracker: async () => fail(),
  hostedServerDeployVoicePlugin: async () => fail(),
  hostedServerIsVoicePluginDeployed: async (): Promise<boolean> => false,
  hostedServerUndeployVoicePlugin: async () => fail(),
  hostedServerIsBanPluginDeployed: async (): Promise<boolean> => false,

  // ── Mod load order / deployed mods ──
  // Renderer (ModsPanel.tsx) reads `result.success && result.data.orders`,
  // so we must return the wrapped envelope shape, not a bare array.
  hostedServerGetModLoadOrder: async (): Promise<{
    success: true
    data: { version: 1; orders: Record<string, number> }
  }> => ({ success: true, data: { version: 1, orders: {} } }),
  hostedServerSetModLoadOrder: async (): Promise<{ success: true }> => ({ success: true }),
  hostedServerDeployedMods: async (): Promise<string[]> => [],
  hostedServerUndeployMod: async (): Promise<void> => {},
  hostedServerGetServersWithMod: async (): Promise<Array<{ id: string; name: string }>> => [],

  // ── Backups ──
  hostedServerGetSchedule: async () => ({
    enabled: false, frequency: 'daily', timeOfDay: '03:00', dayOfWeek: 0, maxBackups: 10,
    lastBackup: null as number | null, nextBackup: null as number | null
  }),
  hostedServerSaveSchedule: async () => fail(),
  hostedServerCreateBackup: async () => fail(),
  hostedServerListBackups: async (): Promise<unknown[]> => [],
  hostedServerDeleteBackup: async () => fail(),
  hostedServerRestoreBackup: async () => fail(),

  // ── Scheduled tasks ──
  hostedServerGetTasks: async (): Promise<unknown[]> => [],
  hostedServerSaveTask: async () => fail(),
  hostedServerCreateTask: async () => fail(),
  hostedServerDeleteTask: async () => fail(),
  hostedServerRunTaskNow: async () => fail(),

  // ── Analytics ── must match AnalyticsData in src/shared/types.ts:
  //   { dailyStats, playerSummaries, ipSummaries, activeSessions,
  //     sessionHistory, totalSessions, uniqueIpCount }
  hostedServerGetAnalytics: async (): Promise<{
    dailyStats: unknown[]
    playerSummaries: unknown[]
    ipSummaries: unknown[]
    activeSessions: unknown[]
    sessionHistory: unknown[]
    totalSessions: number
    uniqueIpCount: number
  }> => ({
    dailyStats: [],
    playerSummaries: [],
    ipSummaries: [],
    activeSessions: [],
    sessionHistory: [],
    totalSessions: 0,
    uniqueIpCount: 0
  }),
  hostedServerClearAnalytics: async (): Promise<void> => {},
  hostedServerSetIpMeta: async () => fail(),
  hostedServerUpdatePlayerTracking: async () => fail(),
  hostedServerEndAllSessions: async () => fail(),

  // ── Mod-gate ──
  hostedServerGetModGateConfig: async () => ({ exists: false, config: null }),
  hostedServerSaveModGateConfig: async () => fail(),
  hostedServerGetModGateVehiclePreview: async (): Promise<string | null> => null,

  // ── Support tickets ──
  hostedServerListSupportTickets: async (): Promise<unknown[]> => [],
  hostedServerCreateSupportTicket: async () => fail(),
  hostedServerUpdateSupportTicket: async (): Promise<null> => null,
  hostedServerDeleteSupportTicket: async (): Promise<boolean> => false,
  // Support ingest status — must match HostedServerSupportIngestStatus
  // (types.ts): { running, senderDeployed, config: {enabled, port, token,
  // publicHost}, endpointPath, endpointExample }. SupportPanel reads
  // `ingest.config.token.slice(0,8)` so `token` must be a non-empty string.
  hostedServerGetSupportIngestStatus: async () => ({
    running: false,
    senderDeployed: false,
    config: {
      enabled: false,
      port: 7777,
      token: 'demo-token-0000000000000000000000000000',
      publicHost: 'localhost'
    },
    endpointPath: '/support/ingest',
    endpointExample: 'http://localhost:7777/support/ingest'
  }),
  hostedServerUpdateSupportIngestConfig: async () => ({
    running: false,
    senderDeployed: false,
    config: {
      enabled: false,
      port: 7777,
      token: 'demo-token-0000000000000000000000000000',
      publicHost: 'localhost'
    },
    endpointPath: '/support/ingest',
    endpointExample: 'http://localhost:7777/support/ingest'
  }),
  hostedServerStartSupportIngest: async () => ({
    running: false,
    senderDeployed: false,
    config: {
      enabled: false,
      port: 7777,
      token: 'demo-token-0000000000000000000000000000',
      publicHost: 'localhost'
    },
    endpointPath: '/support/ingest',
    endpointExample: 'http://localhost:7777/support/ingest'
  }),
  hostedServerStopSupportIngest: async () => ({
    running: false,
    senderDeployed: false,
    config: {
      enabled: false,
      port: 7777,
      token: 'demo-token-0000000000000000000000000000',
      publicHost: 'localhost'
    },
    endpointPath: '/support/ingest',
    endpointExample: 'http://localhost:7777/support/ingest'
  }),
  // Support ticket UI config — must match HostedServerSupportTicketUiConfig
  hostedServerGetSupportTicketUiConfig: async () => ({
    topics: ['Bug Report', 'Player Report', 'Other'],
    maxMessageLength: 2000,
    enablePriorityDropdown: true,
    reporterIdentityMode: 'auto' as const,
    includeLogsSnapshot: true,
    includeSessionMetadata: true,
    includeLocation: true,
    includeLoadedMods: true,
    includeVersions: true,
    includePcSpecs: false
  }),
  hostedServerUpdateSupportTicketUiConfig: async () => ({
    topics: ['Bug Report', 'Player Report', 'Other'],
    maxMessageLength: 2000,
    enablePriorityDropdown: true,
    reporterIdentityMode: 'auto' as const,
    includeLogsSnapshot: true,
    includeSessionMetadata: true,
    includeLocation: true,
    includeLoadedMods: true,
    includeVersions: true,
    includePcSpecs: false
  }),
  hostedServerExportSupportSenderMod: async () => fail(),
  hostedServerDeploySupportSenderMod: async () => fail(),
  hostedServerUndeploySupportSenderMod: async () => fail(),
  hostedServerSimulateSupportTicketSubmit: async () => fail(),

  // Launcher log listener used by the renderer for hosted-server start chatter.
  onLauncherLog: (_cb: (line: string) => void): (() => void) => () => {}
}
