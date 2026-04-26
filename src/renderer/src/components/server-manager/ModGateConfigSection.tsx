import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Car, Check, ChevronDown, ChevronRight, Loader2, RefreshCw, Shield, Zap } from 'lucide-react'
import type { HostedServerModGateConfig } from '../../../../preload/index.d'
import { useToastStore } from '../../stores/useToastStore'

interface Props {
  serverId: string
  enabled: boolean
  onToggleEnabled: (enabled: boolean) => Promise<void>
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; config: HostedServerModGateConfig }
  | { status: 'error'; message: string }

interface VehicleRow {
  name: string
  displayName: string
  stock: boolean
  modded: boolean
  isVehicle: boolean
}

type VehicleSort = 'name' | 'modded' | 'stock' | 'type' | 'disabled'

const OBJECT_HINTS = [
  'prop', 'object', 'barrier', 'cone', 'sign', 'ramp', 'pallet',
  'container', 'crate', 'fence', 'wall', 'block', 'bench', 'trash',
  'streetlight', 'lightpole', 'bollard', 'traffic', 'roadblock',
  'trailer', 'utility', 'cannon', 'haybale', 'logs', 'rock',
]

const ROW_CLICK_GUARD_MS = 250
const ALLOW_CONFIRM_MS = 2000
const DEFAULT_BLOCKED_MESSAGE = 'Vehicle blocked: only server-provided mod packs are allowed on this server.'

function isLikelyObject(name: string, displayName: string): boolean {
  const text = `${name} ${displayName}`.toLowerCase()
  return OBJECT_HINTS.some((k) => text.includes(k))
}

function formatVehicleIdFallback(id: string): string {
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function ModGateConfigSection({ serverId, enabled, onToggleEnabled }: Props): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [, setMsg] = useState<string | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<VehicleSort>('name')
  const [thumbByVehicle, setThumbByVehicle] = useState<Record<string, string | null>>({})
  const [knownVehicles, setKnownVehicles] = useState<Set<string>>(new Set())
  const [blockedMessage, setBlockedMessage] = useState(DEFAULT_BLOCKED_MESSAGE)
  const [savedBlockedMessage, setSavedBlockedMessage] = useState(DEFAULT_BLOCKED_MESSAGE)
  const rowActionGuardRef = useRef<Map<string, number>>(new Map())
  const pendingAllowConfirmRef = useRef<Map<string, number>>(new Map())
  const addToast = useToastStore((s) => s.addToast)

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setState({ status: 'loading' })
    setMsg(null)
    try {
      const res = await window.api.hostedServerGetModGateConfig(serverId)
      if (!res.config) {
        setState({ status: 'error', message: 'No mod gate config available for this server yet.' })
        return
      }
      setState({ status: 'ready', config: res.config })
      setSelected(new Set((res.config.allowedVehicleNames || []).map((v) => v.toLowerCase())))
      const msg = (res.config.blockedMessage || '').trim() || DEFAULT_BLOCKED_MESSAGE
      setBlockedMessage(msg)
      setSavedBlockedMessage(msg)
    } catch (e) {
      setState({ status: 'error', message: String(e) })
    }
  }, [serverId])

  useEffect(() => { void load(true) }, [load])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await window.api.listVehicles()
        if (cancelled) return
        setKnownVehicles(new Set((list || []).map((v) => v.name.toLowerCase())))
      } catch {
        if (!cancelled) setKnownVehicles(new Set())
      }
    })()
    return () => { cancelled = true }
  }, [])

  const rows = useMemo<VehicleRow[]>(() => {
    if (state.status !== 'ready') return []
    const stock = new Set((state.config.stockVehicleNames || []).map((v) => v.toLowerCase()))
    const server = new Set((state.config.serverVehicleNames || []).map((v) => v.toLowerCase()))
    const displayNames = state.config.vehicleDisplayNames || {}
    const all = new Set<string>([...stock, ...server])
    const result: VehicleRow[] = []
    for (const name of all) {
      const displayName = (displayNames[name] || '').trim() || formatVehicleIdFallback(name)
      const fromScanner = knownVehicles.has(name)
      const likelyObject = isLikelyObject(name, displayName)
      result.push({
        name,
        displayName,
        stock: stock.has(name),
        modded: server.has(name),
        // Scanner output is authoritative when present. For server-discovered
        // entries that the scanner doesn't know about yet, default to vehicle
        // unless the id/display strongly indicates prop/object content.
        isVehicle: fromScanner || (server.has(name) && !likelyObject),
      })
    }
    return result
  }, [state, knownVehicles])

  const naturalOrder = useMemo(() => {
    const indexByName = new Map<string, number>()
    rows.forEach((row, index) => indexByName.set(row.name, index))
    return indexByName
  }, [rows])

  const labelByName = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows) {
      map.set(row.name, row.displayName)
    }
    return map
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = q
      ? rows.filter((r) => r.name.includes(q) || r.displayName.toLowerCase().includes(q))
      : rows
    const sorted = [...base]
    sorted.sort((a, b) => {
      if (sortBy === 'disabled') {
        const aBlocked = !selected.has(a.name)
        const bBlocked = !selected.has(b.name)
        if (aBlocked !== bBlocked) return aBlocked ? -1 : 1
      } else if (sortBy === 'modded') {
        if (a.modded !== b.modded) return a.modded ? -1 : 1
        if (a.stock !== b.stock) return a.stock ? -1 : 1
      } else if (sortBy === 'stock') {
        if (a.stock !== b.stock) return a.stock ? -1 : 1
        if (a.modded !== b.modded) return a.modded ? -1 : 1
      } else if (sortBy === 'type') {
        // Real type split based on vehicle scanner output:
        // known drivable vehicles first, object-like entries last.
        if (a.isVehicle !== b.isVehicle) return a.isVehicle ? -1 : 1
        const aIndex = naturalOrder.get(a.name) ?? 0
        const bIndex = naturalOrder.get(b.name) ?? 0
        if (aIndex !== bIndex) return aIndex - bIndex
      }
      return a.displayName.localeCompare(b.displayName)
    })
    return sorted
  }, [rows, naturalOrder, search, sortBy])

  useEffect(() => {
    const missing = filtered
      .map((r) => r.name)
      .filter((name) => !(name in thumbByVehicle))
      .slice(0, 80)
    if (missing.length === 0) return

    let cancelled = false
    ;(async () => {
      const updates: Record<string, string | null> = {}
      await Promise.all(missing.map(async (name) => {
        const row = filtered.find((r) => r.name === name)
        try {
          let preview = await window.api.getVehiclePreview(name)
          if (!preview && row?.modded) {
            preview = await window.api.hostedServerGetModGateVehiclePreview(serverId, name)
          }
          updates[name] = preview
        } catch {
          updates[name] = null
        }
      }))
      if (cancelled) return
      setThumbByVehicle((prev) => ({ ...prev, ...updates }))
    })()

    return () => { cancelled = true }
  }, [filtered, serverId, thumbByVehicle])

  const saveWithSet = useCallback(async (nextSelected: Set<string>, nextBlockedMessage: string, successToast?: string): Promise<void> => {
    setSaving(true)
    setSaveStatus('saving')
    setSaveError(null)
    try {
      const allowedVehicleNames = Array.from(nextSelected).sort((a, b) => a.localeCompare(b))
      const knownVehicleNames = rows.map((r) => r.name).sort((a, b) => a.localeCompare(b))
      const blockedMessageToSave = nextBlockedMessage.trim() || DEFAULT_BLOCKED_MESSAGE
      const res = await window.api.hostedServerSaveModGateConfig(serverId, {
        allowedVehicleNames,
        knownVehicleNames,
        blockedMessage: blockedMessageToSave,
      })
      if (!res.success) {
        setSaveStatus('error')
        setSaveError(res.error || 'Failed to save vehicle gate list')
      } else {
        setSavedBlockedMessage(blockedMessageToSave)
        setSaveStatus('saved')
        if (successToast) addToast(successToast, 'success')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
      }
    } catch (e) {
      setSaveStatus('error')
      const msg = String(e)
      setSaveError(msg)
      addToast(msg, 'error')
    } finally {
      setSaving(false)
    }
  }, [serverId, rows, addToast])

  const shouldSkipRowAction = (name: string): boolean => {
    const now = Date.now()
    const last = rowActionGuardRef.current.get(name) ?? 0
    if (now - last < ROW_CLICK_GUARD_MS) return true
    rowActionGuardRef.current.set(name, now)
    return false
  }

  const setVehicleAllowed = (name: string, allow: boolean): void => {
    if (shouldSkipRowAction(name)) return
    const alreadyAllowed = selected.has(name)
    if (alreadyAllowed === allow) return

    const display = labelByName.get(name) ?? name
    if (allow && !alreadyAllowed) {
      const now = Date.now()
      const lastAsk = pendingAllowConfirmRef.current.get(name) ?? 0
      if (now - lastAsk > ALLOW_CONFIRM_MS) {
        pendingAllowConfirmRef.current.set(name, now)
        addToast(`Click Allow again to confirm: ${display}`, 'info')
        return
      }
      pendingAllowConfirmRef.current.delete(name)
    } else {
      pendingAllowConfirmRef.current.delete(name)
    }

    const next = new Set(selected)
    if (allow) next.add(name)
    else next.delete(name)
    setSelected(next)
    void saveWithSet(next, blockedMessage, `${allow ? 'Allowed' : 'Blocked'} ${display}`)
  }

  const saveBlockedMessage = (): void => {
    const msg = blockedMessage.trim() || DEFAULT_BLOCKED_MESSAGE
    if (msg === savedBlockedMessage) return
    void saveWithSet(new Set(selected), msg, 'Blocked message updated')
  }

  const setProtectionEnabled = async (nextEnabled: boolean): Promise<void> => {
    if (nextEnabled === enabled || toggling) return
    setToggling(true)
    setMsg(null)
    try {
      await onToggleEnabled(nextEnabled)
      setMsg(nextEnabled ? 'Sideload Protection enabled and deployed' : 'Sideload Protection disabled and undeployed')
      await load()
    } catch (e) {
      setMsg(`Failed to update Sideload Protection: ${String(e)}`)
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="mt-6 p-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)] w-full">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <Shield size={14} />
            Vehicle Sideload Protection
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[10px] font-medium">
              <Zap size={9} className="fill-current" />
              Live
            </span>
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            When enabled, unknown vehicles that are not on this list are blocked from spawning.
            Vehicles on this list are discovered automatically (stock + server), and unchecking a listed
            vehicle blocks spawning for that vehicle.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-active)] border border-[var(--color-border)] transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-active)] border border-[var(--color-border)] transition-colors"
          >
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            {collapsed ? 'Expand Checklist' : 'Collapse Checklist'}
          </button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm text-[var(--color-text-secondary)]">Sideload Protection</span>
        <div className="inline-flex rounded border border-[var(--color-border)] overflow-hidden">
          <button
            type="button"
            onClick={() => void setProtectionEnabled(true)}
            disabled={toggling || enabled}
            className={`px-2.5 py-1 text-xs font-semibold transition-colors ${enabled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)]'} disabled:opacity-60`}
          >
            {toggling && !enabled ? 'Enabling...' : 'Enable'}
          </button>
          <button
            type="button"
            onClick={() => void setProtectionEnabled(false)}
            disabled={toggling || !enabled}
            className={`px-2.5 py-1 text-xs font-semibold border-l border-[var(--color-border)] transition-colors ${!enabled ? 'bg-red-500/20 text-red-300' : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)]'} disabled:opacity-60`}
          >
            {toggling && enabled ? 'Disabling...' : 'Disable'}
          </button>
        </div>
        <span className={`text-xs ${enabled ? 'text-emerald-300' : 'text-[var(--color-text-muted)]'}`}>
          {enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      <p className="mb-3 text-[11px] text-[var(--color-text-muted)]">
        Use Block/Allow buttons per vehicle. Changes autosave and apply live.
        <span className="ml-2 inline-flex items-center gap-1 text-emerald-400">
          <Zap size={9} className="fill-current" />
          Changes autosave and apply live — no server restart needed.
        </span>
      </p>
      <p className="mb-3 text-[11px] text-[var(--color-text-muted)]">
        Enable/Disable applies immediately by deploying or removing the server-side protection plugin.
      </p>

      {!collapsed && state.status === 'ready' && (
        <div className="mb-3 space-y-1">
          <label className="text-xs text-[var(--color-text-secondary)]">Blocked chat message</label>
          <div className="flex items-center gap-2">
            <input
              value={blockedMessage}
              onChange={(e) => setBlockedMessage(e.target.value)}
              placeholder={DEFAULT_BLOCKED_MESSAGE}
              className="flex-1 px-2 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-border-accent)] outline-none rounded"
            />
            <button
              type="button"
              onClick={saveBlockedMessage}
              disabled={(blockedMessage.trim() || DEFAULT_BLOCKED_MESSAGE) === savedBlockedMessage}
              className="px-2.5 py-1.5 text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-active)] disabled:opacity-40"
            >
              Save message
            </button>
          </div>
        </div>
      )}

      {!collapsed && state.status === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <Loader2 size={14} className="animate-spin" /> Loading vehicle registry...
        </div>
      )}

      {!collapsed && state.status === 'error' && (
        <div className="text-xs text-red-400">{state.message}</div>
      )}

      {!collapsed && state.status === 'ready' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
            <span>Detected: {rows.length}</span>
            <span>Allowed: {selected.size}</span>
            <span>Blocked: {Math.max(0, rows.length - selected.size)}</span>
          </div>

          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter vehicles..."
              className="flex-1 px-2 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-border-accent)] outline-none rounded"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as VehicleSort)}
              className="px-2 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-border-accent)] outline-none rounded"
              title="Sort vehicles"
            >
              <option value="name">Name</option>
              <option value="disabled">Disabled first</option>
              <option value="type">Type</option>
              <option value="modded">Modded first</option>
              <option value="stock">Stock first</option>
            </select>
          </div>

          <div className="max-h-72 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-scrim-20)]">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--color-text-muted)]">No vehicles match the filter.</div>
            ) : (
              filtered.map((row) => (
                <div key={row.name} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface)]/40">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-10 h-7 shrink-0 rounded border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)] flex items-center justify-center">
                      {thumbByVehicle[row.name] ? (
                        <img
                          src={thumbByVehicle[row.name] || ''}
                          alt={row.displayName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Car size={12} className="text-[var(--color-text-muted)]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm text-[var(--color-text-primary)] truncate">{row.displayName}</div>
                      {row.displayName !== row.name && (
                        <div className="text-[11px] text-[var(--color-text-muted)] truncate">{row.name}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full border ${row.isVehicle ? 'border-violet-500/30 text-violet-300 bg-violet-500/10' : 'border-orange-500/30 text-orange-300 bg-orange-500/10'}`}
                    >
                      {row.isVehicle ? 'vehicle' : 'object'}
                    </span>
                    {row.stock && <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-sky-500/30 text-sky-300 bg-sky-500/10">stock</span>}
                    {row.modded && <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-500/30 text-emerald-300 bg-emerald-500/10">modded</span>}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${selected.has(row.name) ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' : 'border-red-500/30 text-red-300 bg-red-500/10'}`}>
                      {selected.has(row.name) ? 'allowed' : 'blocked'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setVehicleAllowed(row.name, false)}
                      disabled={!selected.has(row.name)}
                      className="text-[10px] px-2 py-0.5 rounded border border-red-500/30 text-red-300 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40"
                    >
                      Block
                    </button>
                    <button
                      type="button"
                      onClick={() => setVehicleAllowed(row.name, true)}
                      disabled={selected.has(row.name)}
                      className="text-[10px] px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40"
                    >
                      Allow
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-2 h-5">
            {saveStatus === 'saving' && (
              <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                <Loader2 size={11} className="animate-spin" /> Saving...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <Check size={11} /> Saved
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-xs text-red-400">{saveError}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
