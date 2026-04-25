import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, CircleDot, Copy, Filter, Inbox, LifeBuoy, ListOrdered, Loader2, Minus, RefreshCw, Search, Trash2, XCircle, AlertTriangle } from 'lucide-react'
import type {
  HostedServerSupportIngestStatus,
  HostedServerSupportTicketUiConfig,
  SupportTicket,
  SupportTicketPriority,
  SupportTicketStatus,
  SupportTicketUpdateInput,
} from '../../../../shared/types'
import { useConfirmDialog } from '../../hooks/useConfirmDialog'

const STATUS_OPTIONS: Array<SupportTicketStatus | 'all'> = [
  'all',
  'new',
  'triaged',
  'in-progress',
  'resolved',
  'closed',
]

const PRIORITY_OPTIONS: Array<SupportTicketPriority | 'all'> = ['all', 'low', 'normal', 'high', 'urgent']

const STATUS_SORT_ORDER: Record<SupportTicketStatus, number> = {
  new: 0,
  triaged: 1,
  'in-progress': 2,
  resolved: 3,
  closed: 4,
}

const PRIORITY_SORT_ORDER: Record<SupportTicketPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
}

function formatTicketLabel(raw: string): string {
  return raw.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function getStatusMeta(status: SupportTicketStatus): { icon: React.ComponentType<{ size?: number; className?: string }>; className: string } {
  switch (status) {
    case 'new':
      return { icon: CircleDot, className: 'text-sky-300' }
    case 'triaged':
      return { icon: Search, className: 'text-indigo-300' }
    case 'in-progress':
      return { icon: Loader2, className: 'text-amber-300' }
    case 'resolved':
      return { icon: CheckCircle2, className: 'text-green-300' }
    case 'closed':
      return { icon: XCircle, className: 'text-slate-300' }
  }
}

function getPriorityMeta(priority: SupportTicketPriority): { icon: React.ComponentType<{ size?: number; className?: string }>; className: string } {
  switch (priority) {
    case 'low':
      return { icon: ArrowDown, className: 'text-emerald-300' }
    case 'normal':
      return { icon: Minus, className: 'text-slate-300' }
    case 'high':
      return { icon: ArrowUp, className: 'text-orange-300' }
    case 'urgent':
      return { icon: AlertTriangle, className: 'text-red-300' }
  }
}

type TicketIncludeFlags = Pick<
  HostedServerSupportTicketUiConfig,
  | 'includeLogsSnapshot'
  | 'includeSessionMetadata'
  | 'includeLocation'
  | 'includeLoadedMods'
  | 'includeVersions'
  | 'includePcSpecs'
>

const DEFAULT_INCLUDE_FLAGS: TicketIncludeFlags = {
  includeLogsSnapshot: true,
  includeSessionMetadata: true,
  includeLocation: true,
  includeLoadedMods: true,
  includeVersions: true,
  includePcSpecs: true,
}

const INCLUDE_FLAG_LABELS: Array<{ key: keyof TicketIncludeFlags; label: string }> = [
  { key: 'includeLogsSnapshot', label: 'Logs Snapshot' },
  { key: 'includeSessionMetadata', label: 'Session Metadata' },
  { key: 'includeLocation', label: 'Location' },
  { key: 'includeLoadedMods', label: 'Loaded Mods' },
  { key: 'includeVersions', label: 'Versions' },
  { key: 'includePcSpecs', label: 'PC Specs' },
]

function parseTopicsInput(raw: string): string[] {
  return raw
    .split('\n')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .slice(0, 20)
    .map((v) => v.slice(0, 64))
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function prettyFieldName(field: string): string {
  return field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return 'n/a'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'n/a'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'string') return value.trim() || 'n/a'
  return JSON.stringify(value)
}

function splitLogLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n')
}

function renderObjectRows(data: unknown): React.JSX.Element {
  if (!isRecord(data)) {
    return <div className="text-xs text-[var(--color-text-secondary)]">{formatScalar(data)}</div>
  }
  const entries = Object.entries(data)
  if (entries.length === 0) {
    return <div className="text-xs text-[var(--color-text-muted)]">No data captured.</div>
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="text-xs">
          <span className="text-[var(--color-text-muted)]">{prettyFieldName(key)}: </span>
          <span className="text-[var(--color-text-primary)] break-words">{Array.isArray(value) ? value.join(', ') || 'n/a' : formatScalar(value)}</span>
        </div>
      ))}
    </div>
  )
}

function LocationMinimap({ locationData }: { locationData: unknown }): React.JSX.Element {
  const [minimapData, setMinimapData] = useState<{
    dataUrl: string
    worldBounds?: { minX: number; maxX: number; minY: number; maxY: number }
  } | null>(null)
  const [loading, setLoading] = useState(false)

  const mapRaw = isRecord(locationData) && typeof locationData.map === 'string' ? locationData.map : null
  const mapName = mapRaw
    ? mapRaw
      .replace(/^\/?levels\//i, '')
      .replace(/\/(main\.level|info)\.json$/i, '')
      .replace(/\/$/, '')
    : null
  const locX = isRecord(locationData) && typeof locationData.x === 'number' ? locationData.x : null
  const locY = isRecord(locationData) && typeof locationData.y === 'number' ? locationData.y : null
  const locZ = isRecord(locationData) && typeof locationData.z === 'number' ? locationData.z : null
  const speed = isRecord(locationData) && typeof locationData.speedKph === 'number' ? locationData.speedKph : null

  useEffect(() => {
    if (!mapName) { setMinimapData(null); return }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const data = await window.api.getMapMinimap(`/levels/${mapName}/`)
        if (!cancelled) setMinimapData(data)
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [mapName])

  let dotLeft: number | null = null
  let dotTop: number | null = null
  if (locX !== null && locY !== null && minimapData?.worldBounds) {
    const { minX, maxX, minY, maxY } = minimapData.worldBounds
    const left = ((locX - minX) / (maxX - minX)) * 100
    const top = (1 - (locY - minY) / (maxY - minY)) * 100
    dotLeft = Math.max(0, Math.min(100, left))
    dotTop = Math.max(0, Math.min(100, top))
  }

  const mapLabel = mapName ? mapName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null

  if (loading) {
    return <div className="text-xs text-[var(--color-text-muted)]">Loading minimap…</div>
  }

  if (minimapData?.dataUrl) {
    return (
      <div className="space-y-1">
        {mapLabel && <div className="text-xs text-[var(--color-text-muted)]">{mapLabel}</div>}
        <div className="relative w-full rounded overflow-hidden border border-[var(--color-border)]" style={{ aspectRatio: '1 / 1' }}>
          <img src={minimapData.dataUrl} alt="minimap" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
          {dotLeft !== null && dotTop !== null && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${dotLeft}%`,
                top: `${dotTop}%`,
                transform: 'translate(-50%, -50%)',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: 'var(--color-accent)',
                border: '2px solid white',
                boxShadow: '0 0 6px rgba(0,0,0,0.8)',
              }}
            />
          )}
        </div>
        {locX !== null && (
          <div className="text-xs text-[var(--color-text-muted)]">
            X: {locX.toFixed(1)}, Y: {locY?.toFixed(1) ?? 'n/a'}, Z: {locZ?.toFixed(1) ?? 'n/a'}
            {speed !== null && ` · ${speed.toFixed(0)} km/h`}
          </div>
        )}
      </div>
    )
  }

  // No minimap — show coords as plain text, with a clean map label
  return (
    <div className="space-y-1">
      {mapLabel && <div className="text-xs text-[var(--color-text-muted)]">{mapLabel}</div>}
      {locX !== null ? (
        <div className="text-xs text-[var(--color-text-primary)]">
          X: {locX.toFixed(1)}, Y: {locY?.toFixed(1) ?? 'n/a'}, Z: {locZ?.toFixed(1) ?? 'n/a'}
          {speed !== null && ` · ${speed.toFixed(0)} km/h`}
        </div>
      ) : (
        <div className="text-xs text-[var(--color-text-muted)]">No location captured.</div>
      )}
    </div>
  )
}

interface SupportPanelProps {
  serverId: string
}

export function SupportPanel({ serverId }: SupportPanelProps): React.JSX.Element {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [ingest, setIngest] = useState<HostedServerSupportIngestStatus | null>(null)
  const [ticketUiConfig, setTicketUiConfig] = useState<HostedServerSupportTicketUiConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | 'all'>('all')
  const [priorityFilter, setPriorityFilter] = useState<SupportTicketPriority | 'all'>('all')
  const [organizeBy, setOrganizeBy] = useState<'created' | 'status' | 'priority'>('created')
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [configuratorOpen, setConfiguratorOpen] = useState(false)
  const [publicHostDraft, setPublicHostDraft] = useState('')
  const [topicsDraft, setTopicsDraft] = useState('')
  const [maxMessageLengthDraft, setMaxMessageLengthDraft] = useState('1500')
  const [priorityDropdownDraft, setPriorityDropdownDraft] = useState(false)
  const [reporterModeDraft, setReporterModeDraft] = useState<'auto' | 'manual'>('auto')
  const [includeDraft, setIncludeDraft] = useState<TicketIncludeFlags>(DEFAULT_INCLUDE_FLAGS)
  const [simSubject, setSimSubject] = useState('')
  const [simPriority, setSimPriority] = useState<SupportTicketPriority>('normal')
  const [simMessage, setSimMessage] = useState('')
  const [simReporterName, setSimReporterName] = useState('')
  const [simReporterBeammpId, setSimReporterBeammpId] = useState('')
  const [simIncludeFlags, setSimIncludeFlags] = useState<TicketIncludeFlags>(DEFAULT_INCLUDE_FLAGS)
  const { dialog: confirmDialog, confirm } = useConfirmDialog()

  const selected = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedId) ?? tickets[0] ?? null,
    [tickets, selectedId],
  )

  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tickets.filter((ticket) => {
      if (statusFilter !== 'all' && ticket.status !== statusFilter) return false
      if (priorityFilter !== 'all' && ticket.priority !== priorityFilter) return false
      if (!q) return true
      return (
        ticket.subject.toLowerCase().includes(q) ||
        ticket.message.toLowerCase().includes(q) ||
        (ticket.reporterName ?? '').toLowerCase().includes(q) ||
        (ticket.reporterBeammpId ?? '').toLowerCase().includes(q)
      )
    })
  }, [tickets, search, statusFilter, priorityFilter])

  const visibleTickets = useMemo(() => {
    const out = [...filteredTickets]
    if (organizeBy === 'status') {
      out.sort((a, b) => {
        const s = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]
        if (s !== 0) return s
        const p = PRIORITY_SORT_ORDER[b.priority] - PRIORITY_SORT_ORDER[a.priority]
        if (p !== 0) return p
        return b.createdAt - a.createdAt
      })
      return out
    }
    if (organizeBy === 'priority') {
      out.sort((a, b) => {
        const p = PRIORITY_SORT_ORDER[b.priority] - PRIORITY_SORT_ORDER[a.priority]
        if (p !== 0) return p
        const s = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]
        if (s !== 0) return s
        return b.createdAt - a.createdAt
      })
      return out
    }
    out.sort((a, b) => b.createdAt - a.createdAt)
    return out
  }, [filteredTickets, organizeBy])

  const configuratorTopics = useMemo(() => {
    const parsed = parseTopicsInput(topicsDraft)
    return parsed.length > 0 ? parsed : ['General']
  }, [topicsDraft])

  const configuratorMaxLength = useMemo(() => {
    const parsed = Number.parseInt(maxMessageLengthDraft, 10)
    if (!Number.isFinite(parsed)) return 1500
    return Math.min(5000, Math.max(120, parsed))
  }, [maxMessageLengthDraft])

  const load = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setLoading(true)
    try {
      const [loadedTickets, loadedIngest, loadedUiConfig] = await Promise.all([
        window.api.hostedServerListSupportTickets(serverId),
        window.api.hostedServerGetSupportIngestStatus(serverId),
        window.api.hostedServerGetSupportTicketUiConfig(serverId),
      ])
      setTickets(loadedTickets)
      setIngest(loadedIngest)
      setTicketUiConfig(loadedUiConfig)
      setSelectedId((prev) => prev ?? loadedTickets[0]?.id ?? null)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [serverId])

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    void load()
    pollRef.current = setInterval(() => { void load(true) }, 8000)
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current)
    }
  }, [load])

  useEffect(() => {
    setNotesDraft(selected?.internalNotes ?? '')
  }, [selected?.id])

  useEffect(() => {
    if (!configuratorOpen) return
    if (configuratorTopics.includes(simSubject)) return
    setSimSubject(configuratorTopics[0] ?? 'General')
  }, [configuratorOpen, configuratorTopics, simSubject])

  useEffect(() => {
    setPublicHostDraft(ingest?.config.publicHost ?? '')
  }, [ingest?.config.publicHost])

  const updateTicket = async (ticketId: string, patch: SupportTicketUpdateInput): Promise<void> => {
    const updated = await window.api.hostedServerUpdateSupportTicket(serverId, ticketId, patch)
    if (!updated) return
    setTickets((prev) => prev.map((ticket) => (ticket.id === updated.id ? updated : ticket)))
  }

  const deleteSelected = async (): Promise<void> => {
    if (!selected) return
    const ok = await confirm({
      title: 'Delete Support Ticket',
      message: `Delete ticket "${selected.subject}"?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    const deleted = await window.api.hostedServerDeleteSupportTicket(serverId, selected.id)
    if (!deleted) return
    const next = tickets.filter((ticket) => ticket.id !== selected.id)
    setTickets(next)
    setSelectedId(next[0]?.id ?? null)
  }

  const toggleIngest = async (): Promise<void> => {
    if (!ingest) return
    const next = ingest.config.enabled
      ? await window.api.hostedServerStopSupportIngest(serverId)
      : await window.api.hostedServerStartSupportIngest(serverId)
    setIngest(next)
  }

  const regenerateToken = async (): Promise<void> => {
    const token = crypto.randomUUID()
    const next = await window.api.hostedServerUpdateSupportIngestConfig(serverId, { token })
    setIngest(next)
  }

  const toggleSenderMod = async (): Promise<void> => {
    setActionMessage(null)
    if (ingest?.senderDeployed) {
      const result = await window.api.hostedServerUndeploySupportSenderMod(serverId)
      if (!result.success) {
        setActionMessage(`Undeploy failed: ${result.error ?? 'unknown error'}`)
        return
      }
      setActionMessage('Sender mod removed from server client resources')
    } else {
      const result = await window.api.hostedServerDeploySupportSenderMod(serverId)
      if (!result.success) {
        setActionMessage(`Deploy failed: ${result.error ?? 'unknown error'}`)
        return
      }
      setActionMessage(`Sender mod deployed to: ${result.filePath ?? 'server client resources'}`)
    }
    await load()
  }

  const openTicketConfigurator = (): void => {
    if (!ticketUiConfig) return
    setTopicsDraft(ticketUiConfig.topics.join('\n'))
    setMaxMessageLengthDraft(String(ticketUiConfig.maxMessageLength))
    setPriorityDropdownDraft(ticketUiConfig.enablePriorityDropdown)
    setReporterModeDraft(ticketUiConfig.reporterIdentityMode)
    const nextInclude: TicketIncludeFlags = {
      includeLogsSnapshot: ticketUiConfig.includeLogsSnapshot,
      includeSessionMetadata: ticketUiConfig.includeSessionMetadata,
      includeLocation: ticketUiConfig.includeLocation,
      includeLoadedMods: ticketUiConfig.includeLoadedMods,
      includeVersions: ticketUiConfig.includeVersions,
      includePcSpecs: ticketUiConfig.includePcSpecs,
    }
    setIncludeDraft(nextInclude)
    setSimIncludeFlags(nextInclude)
    setSimPriority('normal')
    setSimMessage('')
    setSimReporterName('')
    setSimReporterBeammpId('')
    setSimSubject(ticketUiConfig.topics[0] ?? 'General')
    setConfiguratorOpen(true)
  }

  const saveTicketConfigurator = async (): Promise<void> => {
    const parsedTopics = parseTopicsInput(topicsDraft)
    if (parsedTopics.length === 0) {
      setActionMessage('Configurator save failed: at least one topic is required.')
      return
    }
    const parsedMax = Number.parseInt(maxMessageLengthDraft, 10)
    if (!Number.isFinite(parsedMax) || parsedMax < 120 || parsedMax > 5000) {
      setActionMessage('Configurator save failed: max length must be between 120 and 5000.')
      return
    }
    const next = await window.api.hostedServerUpdateSupportTicketUiConfig(serverId, {
      topics: parsedTopics,
      maxMessageLength: parsedMax,
      enablePriorityDropdown: priorityDropdownDraft,
      reporterIdentityMode: reporterModeDraft,
      ...includeDraft,
    })
    setTicketUiConfig(next)
    setConfiguratorOpen(false)
    setActionMessage('Ticket configurator saved.')

    const warningMessage = ingest?.senderDeployed
      ? 'Changes are saved, but clients will not use them until you redeploy the sender mod and restart the server.'
      : 'Changes are saved. They will take effect after you deploy the sender mod and restart the server.'

    await confirm({
      title: 'Redeploy/Restart Required',
      message: warningMessage,
      confirmLabel: 'Got it',
      cancelLabel: 'Close',
      variant: 'warning',
    })
  }

  const savePublicHost = async (): Promise<void> => {
    if (!ingest) return
    setActionMessage(null)
    const next = await window.api.hostedServerUpdateSupportIngestConfig(serverId, {
      publicHost: publicHostDraft,
    })
    setIngest(next)
    setPublicHostDraft(next.config.publicHost)
    setActionMessage(
      next.config.publicHost
        ? `Support endpoint host saved: ${next.config.publicHost}. Redeploy the sender mod and restart the server for clients to use it.`
        : 'Support endpoint host cleared. Redeploy the sender mod and restart the server before clients can submit again.',
    )
  }

  const pastePublicHost = async (): Promise<void> => {
    setActionMessage(null)
    try {
      const raw = await navigator.clipboard.readText()
      const value = String(raw || '').trim()
      if (!value) {
        setActionMessage('Clipboard is empty.')
        return
      }
      const sanitized = value
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*/, '')
        .replace(/:\d+$/, '')
      setPublicHostDraft(sanitized)
    } catch {
      setActionMessage('Paste from clipboard failed. Click the field and type host manually.')
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LifeBuoy size={16} className="text-[var(--color-accent)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Server Support</span>
          <span className="text-xs text-[var(--color-text-muted)]">{tickets.length} tickets</span>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="px-4 py-3 border-b border-[var(--color-border)] grid grid-cols-1 lg:grid-cols-[1fr_auto_auto_auto_auto_auto_auto_auto] gap-2 items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search subject, message, reporter..."
          className="w-full rounded-lg bg-[var(--color-scrim-20)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-primary)]"
        />

        <div className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          <Filter size={12} />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as SupportTicketStatus | 'all')}
            className="rounded-lg bg-[var(--color-scrim-20)] border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as SupportTicketPriority | 'all')}
          className="rounded-lg bg-[var(--color-scrim-20)] border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
        >
          {PRIORITY_OPTIONS.map((priority) => (
            <option key={priority} value={priority}>{priority}</option>
          ))}
        </select>

        <div className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          <ListOrdered size={12} />
          <select
            value={organizeBy}
            onChange={(e) => setOrganizeBy(e.target.value as 'created' | 'status' | 'priority')}
            className="rounded-lg bg-[var(--color-scrim-20)] border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
          >
            <option value="created">newest</option>
            <option value="status">status</option>
            <option value="priority">priority</option>
          </select>
        </div>

        <button
          onClick={() => void toggleSenderMod()}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border ${
            ingest?.senderDeployed
              ? 'border-red-500/30 text-red-300 hover:bg-red-500/10'
              : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
          }`}
        >
          {ingest?.senderDeployed ? 'Undeploy Sender Mod' : 'Deploy To Server'}
        </button>

        <button
          onClick={openTicketConfigurator}
          disabled={!ticketUiConfig}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          Ticket Configurator
        </button>

        <button
          onClick={() => void toggleIngest()}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border ${ingest?.config.enabled ? 'border-red-500/30 text-red-300 hover:bg-red-500/10' : 'border-green-500/30 text-green-300 hover:bg-green-500/10'}`}
        >
          <Inbox size={12} /> {ingest?.config.enabled ? 'Stop Intake' : 'Start Intake'}
        </button>
      </div>

      {actionMessage && (
        <div className="px-4 py-2 border-b border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] bg-[var(--color-scrim-20)]">
          {actionMessage}
        </div>
      )}

      {configuratorOpen && (
        <div className="px-4 py-4 border-b border-[var(--color-border)] bg-[var(--color-scrim-20)]">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">Ticket Configurator</div>
                <div className="text-xs text-[var(--color-text-muted)]">Configure what clients can submit and preview the in-game support form behavior.</div>
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">Applies on next sender mod deploy</div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-scrim-20)] p-3 space-y-3">
                <div className="text-xs font-semibold text-[var(--color-text-primary)]">Configurator</div>

                <label className="text-xs text-[var(--color-text-muted)] space-y-1 block">
                  <span>Ticket Topics (one per line)</span>
                  <textarea
                    rows={5}
                    value={topicsDraft}
                    onChange={(e) => setTopicsDraft(e.target.value)}
                    className="w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-primary)] resize-none"
                  />
                </label>

                <label className="text-xs text-[var(--color-text-muted)] space-y-1 block">
                  <span>Max Message Length</span>
                  <input
                    value={maxMessageLengthDraft}
                    onChange={(e) => setMaxMessageLengthDraft(e.target.value)}
                    className="w-32 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-primary)]"
                  />
                </label>

                <label className="inline-flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                  <input
                    type="checkbox"
                    checked={priorityDropdownDraft}
                    onChange={(e) => setPriorityDropdownDraft(e.target.checked)}
                  />
                  Enable priority dropdown (low/normal/high)
                </label>

                <label className="text-xs text-[var(--color-text-muted)] space-y-1 block">
                  <span>Reporter identity mode</span>
                  <select
                    value={reporterModeDraft}
                    onChange={(e) => setReporterModeDraft(e.target.value as 'auto' | 'manual')}
                    className="w-40 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-primary)]"
                  >
                    <option value="auto">Auto-populated</option>
                    <option value="manual">Manual entry</option>
                  </select>
                </label>

                <div className="space-y-2">
                  <div className="text-xs text-[var(--color-text-muted)]">Default included data</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {INCLUDE_FLAG_LABELS.map((entry) => (
                      <label key={entry.key} className="inline-flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                        <input
                          type="checkbox"
                          checked={includeDraft[entry.key]}
                          onChange={(e) => setIncludeDraft((prev) => ({ ...prev, [entry.key]: e.target.checked }))}
                        />
                        {entry.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-scrim-20)] p-3 space-y-3">
                <div className="text-xs font-semibold text-[var(--color-text-primary)]">In-Game Form Simulation</div>

                <label className="text-xs text-[var(--color-text-muted)] space-y-1 block">
                  <span>Topic</span>
                  <select
                    value={simSubject}
                    onChange={(e) => setSimSubject(e.target.value)}
                    className="w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-primary)]"
                  >
                    {configuratorTopics.map((topic) => (
                      <option key={topic} value={topic}>{topic}</option>
                    ))}
                  </select>
                </label>

                {priorityDropdownDraft ? (
                  <label className="text-xs text-[var(--color-text-muted)] space-y-1 block">
                    <span>Priority</span>
                    <select
                      value={simPriority}
                      onChange={(e) => setSimPriority(e.target.value as SupportTicketPriority)}
                      className="w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-primary)]"
                    >
                      <option value="low">low</option>
                      <option value="normal">normal</option>
                      <option value="high">high</option>
                    </select>
                  </label>
                ) : (
                  <div className="text-xs text-[var(--color-text-muted)]">Priority is fixed to <span className="text-[var(--color-text-primary)]">normal</span>.</div>
                )}

                {reporterModeDraft === 'manual' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-[var(--color-text-muted)] space-y-1 block">
                      <span>Reporter Name</span>
                      <input
                        value={simReporterName}
                        onChange={(e) => setSimReporterName(e.target.value)}
                        className="w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-primary)]"
                      />
                    </label>
                    <label className="text-xs text-[var(--color-text-muted)] space-y-1 block">
                      <span>BeamMP ID</span>
                      <input
                        value={simReporterBeammpId}
                        onChange={(e) => setSimReporterBeammpId(e.target.value)}
                        className="w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-primary)]"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="text-xs text-[var(--color-text-muted)]">Reporter name and BeamMP ID are auto-populated from in-game networking data.</div>
                )}

                <label className="text-xs text-[var(--color-text-muted)] space-y-1 block">
                  <span>Message ({simMessage.length}/{configuratorMaxLength})</span>
                  <textarea
                    rows={4}
                    value={simMessage}
                    maxLength={configuratorMaxLength}
                    onChange={(e) => setSimMessage(e.target.value)}
                    className="w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-primary)] resize-none"
                  />
                </label>

                <div className="space-y-2">
                  <div className="text-xs text-[var(--color-text-muted)]">Data checkboxes players can toggle</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {INCLUDE_FLAG_LABELS.map((entry) => (
                      <label key={`sim-${entry.key}`} className="inline-flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                        <input
                          type="checkbox"
                          checked={simIncludeFlags[entry.key]}
                          onChange={(e) => setSimIncludeFlags((prev) => ({ ...prev, [entry.key]: e.target.checked }))}
                        />
                        {entry.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfiguratorOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveTicketConfigurator()}
                className="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-black text-xs font-medium hover:brightness-110"
              >
                Save Configurator
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 py-3 border-b border-[var(--color-border)] flex flex-wrap gap-x-4 gap-y-1 items-center text-xs">
        <div className="text-[var(--color-text-muted)]">
          Endpoint: <span className="text-[var(--color-text-primary)]">{ingest?.endpointExample ?? 'loading...'}</span>
        </div>
        <div className="flex items-center gap-2 min-w-[320px]">
          <span className="text-[var(--color-text-muted)]">Public Host</span>
          <input
            value={publicHostDraft}
            onChange={(e) => setPublicHostDraft(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="server IP or DNS name"
            className="w-52 rounded-lg bg-[var(--color-scrim-20)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
          />
          <button
            onClick={() => void pastePublicHost()}
            className="px-2 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
          >
            Paste
          </button>
          <button
            onClick={() => void savePublicHost()}
            className="px-2 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
          >
            Save Host
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-text-muted)]">Token</span>
          <span className="font-mono text-[var(--color-text-primary)]">{ingest?.config.token.slice(0, 8)}...</span>
          <button onClick={() => void regenerateToken()} className="px-2 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]">
            Regenerate
          </button>
          <button onClick={() => void navigator.clipboard.writeText(ingest?.config.token ?? '')} className="px-2 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] inline-flex items-center gap-1">
            <Copy size={11} /> Copy
          </button>
        </div>
        <div className="text-[var(--color-text-muted)]">
          Running: <span className={ingest?.running ? 'text-green-300' : 'text-red-300'}>{ingest?.running ? 'yes' : 'no'}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[320px_minmax(0,1fr)]">
        <div className="border-r border-[var(--color-border)] overflow-y-auto p-3 space-y-2">
          {visibleTickets.length === 0 ? (
            <div className="text-sm text-[var(--color-text-muted)] text-center py-8">No tickets found.</div>
          ) : (
            visibleTickets.map((ticket) => {
              const statusMeta = getStatusMeta(ticket.status)
              const priorityMeta = getPriorityMeta(ticket.priority)
              const StatusIcon = statusMeta.icon
              const PriorityIcon = priorityMeta.icon
              return (
                <button
                  key={ticket.id}
                  onClick={() => setSelectedId(ticket.id)}
                  className={`w-full text-left rounded-lg border px-3 py-2 ${ticket.id === selected?.id ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]' : 'border-[var(--color-border)] bg-[var(--color-scrim-20)] hover:bg-[var(--color-surface-hover)]'}`}
                >
                  <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">{ticket.subject}</div>
                  <div className="mt-1 flex items-center gap-2 text-[10px]">
                    <span className={`inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-1.5 py-0.5 ${statusMeta.className}`}>
                      <StatusIcon size={10} className={ticket.status === 'in-progress' ? 'animate-spin' : ''} />
                      {formatTicketLabel(ticket.status)}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-1.5 py-0.5 ${priorityMeta.className}`}>
                      <PriorityIcon size={10} />
                      {formatTicketLabel(ticket.priority)}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">{fmtDate(ticket.createdAt)}</div>
                </button>
              )
            })
          )}
        </div>

        <div className="overflow-y-auto p-4">
          {!selected ? (
            <div className="text-sm text-[var(--color-text-muted)] text-center py-12">Select a ticket.</div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{selected.subject}</h3>
                <button onClick={() => void deleteSelected()} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 text-xs">
                  <Trash2 size={12} /> Delete
                </button>
              </div>

              <div className="text-xs text-[var(--color-text-muted)]">
                Reporter: <span className="text-[var(--color-text-primary)]">{selected.reporterName ?? 'Unknown'}</span>
                {' • '}
                BeamMP ID: <span className="text-[var(--color-text-primary)]">{selected.reporterBeammpId ?? 'n/a'}</span>
                {' • '}
                Created: <span className="text-[var(--color-text-primary)]">{fmtDate(selected.createdAt)}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-[var(--color-text-muted)] space-y-1">
                  <span>Status</span>
                  <select value={selected.status} onChange={(e) => void updateTicket(selected.id, { status: e.target.value as SupportTicketStatus })} className="w-full rounded-lg bg-[var(--color-scrim-20)] border border-[var(--color-border)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]">
                    {STATUS_OPTIONS.filter((s) => s !== 'all').map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>

                <label className="text-xs text-[var(--color-text-muted)] space-y-1">
                  <span>Priority</span>
                  <select value={selected.priority} onChange={(e) => void updateTicket(selected.id, { priority: e.target.value as SupportTicketPriority })} className="w-full rounded-lg bg-[var(--color-scrim-20)] border border-[var(--color-border)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]">
                    {PRIORITY_OPTIONS.filter((p) => p !== 'all').map((priority) => (
                      <option key={priority} value={priority}>{priority}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="text-xs text-[var(--color-text-muted)] space-y-1 block">
                <span>Reporter Message</span>
                <textarea
                  value={selected.message}
                  readOnly
                  rows={4}
                  className="w-full rounded-lg bg-[var(--color-scrim-20)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)] resize-y"
                />
              </label>

              <label className="text-xs text-[var(--color-text-muted)] space-y-1 block">
                <span>Internal Notes</span>
                <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} rows={4} className="w-full rounded-lg bg-[var(--color-scrim-20)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)] resize-none" />
              </label>

              <div className="flex justify-end">
                <button
                  onClick={() => void updateTicket(selected.id, { internalNotes: notesDraft || undefined })}
                  className="px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-black text-xs font-medium hover:brightness-110"
                >
                  Save Manager Notes
                </button>
              </div>

              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-scrim-20)] p-3">
                <div className="text-xs font-semibold text-[var(--color-text-primary)] mb-2 inline-flex items-center gap-2">
                  <Search size={12} /> Captured Payload
                </div>
                {(() => {
                  const payload = isRecord(selected.payload) ? selected.payload : {}
                  const rawLogs = payload.logsSnapshot
                  const logsText = typeof rawLogs === 'string'
                    ? rawLogs
                    : (isRecord(rawLogs) && typeof rawLogs.text === 'string' ? rawLogs.text : '')
                  const logLines = logsText ? splitLogLines(logsText) : []
                  const sessionData = payload.sessionMetadata
                  const locationData = payload.location
                  const loadedMods = Array.isArray(payload.loadedMods) ? payload.loadedMods : []
                  const versionsData = payload.versions
                  const pcSpecsData = payload.pcSpecs

                  const knownKeys = new Set(['logsSnapshot', 'sessionMetadata', 'location', 'loadedMods', 'versions', 'pcSpecs'])
                  const extraEntries = Object.entries(payload).filter(([key]) => !knownKeys.has(key))

                  return (
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="text-xs font-semibold text-[var(--color-text-primary)]">Log Snapshot</div>
                          {logsText && (
                            <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
                              <span>{logLines.length} lines</span>
                              <button
                                onClick={() => void navigator.clipboard.writeText(logsText)}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
                              >
                                <Copy size={10} /> Copy
                              </button>
                            </div>
                          )}
                        </div>
                        {logsText ? (
                          <div className="max-h-72 overflow-auto rounded border border-slate-700/70 bg-slate-950/80">
                            <div className="font-mono text-[11px] leading-5 text-slate-100">
                              {logLines.map((line, idx) => (
                                <div key={`log-line-${idx}`} className="grid grid-cols-[3.5rem_minmax(0,1fr)]">
                                  <div className="select-none text-right pr-2 text-slate-500 border-r border-slate-800 bg-slate-900/70">{idx + 1}</div>
                                  <div className="pl-3 pr-2 whitespace-pre-wrap break-words">{line || ' '}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-[var(--color-text-muted)]">No log snapshot captured.</div>
                        )}
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-[var(--color-text-primary)] mb-1">Session Metadata</div>
                        {renderObjectRows(sessionData)}
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-[var(--color-text-primary)] mb-1">Location</div>
                        <LocationMinimap locationData={locationData} />
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-[var(--color-text-primary)] mb-1">Loaded Mods</div>
                        {loadedMods.length > 0 ? (
                          <div className="max-h-40 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs text-[var(--color-text-primary)] space-y-1">
                            {loadedMods.map((mod, idx) => (
                              <div key={`${mod}-${idx}`} className="break-words">{mod}</div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-[var(--color-text-muted)]">No loaded mods captured.</div>
                        )}
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-[var(--color-text-primary)] mb-1">Versions</div>
                        {renderObjectRows(versionsData)}
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-[var(--color-text-primary)] mb-1">PC Specs</div>
                        {renderObjectRows(pcSpecsData)}
                      </div>

                      {extraEntries.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-[var(--color-text-primary)] mb-1">Additional Payload Fields</div>
                          <div className="space-y-2">
                            {extraEntries.map(([key, value]) => (
                              <div key={key} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
                                <div className="text-xs font-medium text-[var(--color-text-primary)] mb-1">{prettyFieldName(key)}</div>
                                {renderObjectRows(value)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
      {confirmDialog}
    </div>
  )
}
