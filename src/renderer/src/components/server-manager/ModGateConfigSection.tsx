import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Save, Shield } from 'lucide-react'
import type { HostedServerModGateConfig } from '../../../../preload/index.d'

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
  server: boolean
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
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    setMsg(null)
    try {
      const res = await window.api.hostedServerGetModGateConfig(serverId)
      if (!res.config) {
        setState({ status: 'error', message: 'No mod gate config available for this server yet.' })
        return
      }
      setState({ status: 'ready', config: res.config })
      setSelected(new Set((res.config.allowedVehicleNames || []).map((v) => v.toLowerCase())))
    } catch (e) {
      setState({ status: 'error', message: String(e) })
    }
  }, [serverId])

  useEffect(() => { load() }, [load])

  const rows = useMemo<VehicleRow[]>(() => {
    if (state.status !== 'ready') return []
    const stock = new Set((state.config.stockVehicleNames || []).map((v) => v.toLowerCase()))
    const server = new Set((state.config.serverVehicleNames || []).map((v) => v.toLowerCase()))
    const displayNames = state.config.vehicleDisplayNames || {}
    const all = new Set<string>([...stock, ...server])
    const result: VehicleRow[] = []
    for (const name of all) {
      const displayName = (displayNames[name] || '').trim() || formatVehicleIdFallback(name)
      result.push({ name, displayName, stock: stock.has(name), server: server.has(name) })
    }
    result.sort((a, b) => a.displayName.localeCompare(b.displayName))
    return result
  }, [state])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.name.includes(q) || r.displayName.toLowerCase().includes(q))
  }, [rows, search])

  const toggleVehicle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
    setMsg(null)
  }

  const save = async (): Promise<void> => {
    if (state.status !== 'ready') return
    setSaving(true)
    setMsg(null)
    try {
      const allowedVehicleNames = Array.from(selected).sort((a, b) => a.localeCompare(b))
      const res = await window.api.hostedServerSaveModGateConfig(serverId, { allowedVehicleNames })
      if (!res.success) {
        setMsg(res.error || 'Failed to save vehicle gate list')
      } else {
        setMsg('Vehicle allowlist saved')
        await load()
      }
    } finally {
      setSaving(false)
    }
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
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            When enabled, unknown vehicles that are not on this list are blocked from spawning.
            Vehicles on this list are discovered automatically (stock + server), and unchecking a listed
            vehicle blocks spawning for that vehicle.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
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
        Checked = allowed to spawn. Unchecked = blocked from spawning.
      </p>
      <p className="mb-3 text-[11px] text-[var(--color-text-muted)]">
        Enable/Disable applies immediately by deploying or removing the server-side protection plugin.
      </p>

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

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter vehicles..."
            className="w-full px-2 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-border-accent)] outline-none rounded"
          />

          <div className="max-h-72 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-scrim-20)]">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--color-text-muted)]">No vehicles match the filter.</div>
            ) : (
              filtered.map((row) => (
                <label key={row.name} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[var(--color-border)] last:border-b-0 cursor-pointer hover:bg-[var(--color-surface)]/40">
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={selected.has(row.name)}
                      onChange={() => toggleVehicle(row.name)}
                      className="accent-[var(--color-accent)]"
                    />
                    <div className="min-w-0">
                      <div className="text-sm text-[var(--color-text-primary)] truncate">{row.displayName}</div>
                      {row.displayName !== row.name && (
                        <div className="text-[11px] text-[var(--color-text-muted)] truncate">{row.name}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {row.stock && <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-sky-500/30 text-sky-300 bg-sky-500/10">stock</span>}
                    {row.server && <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-500/30 text-emerald-300 bg-emerald-500/10">server</span>}
                  </div>
                </label>
              ))
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? 'Saving...' : 'Save Vehicle Checklist'}
            </button>
            {msg && <span className="text-xs text-[var(--color-text-muted)]">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
