import { useTranslation } from 'react-i18next'
import {
  Play,
  Power,
  Trash2,
  Eraser,
  WrapText,
  ArrowDown,
  Loader2,
  CircleDot,
  RotateCw,
  Boxes,
  TreePine,
  ChevronDown,
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import type { LuaScope } from './luaConsoleShared'

export interface VehicleEntry {
  id: number
  jbeam: string
  player: boolean
}

interface Props {
  deployed: boolean
  connected: boolean
  busy: boolean
  scope: LuaScope
  vehId: number | null
  vehicles: VehicleEntry[]
  onRefreshVehicles: () => void
  onScopeChange: (s: LuaScope) => void
  onVehicleChange: (id: number | null) => void
  onDeploy: () => void
  onUndeploy: () => void
  onRun: () => void
  onClearOutput: () => void
  onClearRemote: () => void
  onReload: (action: 'ge' | 'veh' | 'env') => void
  onToggleInspector: () => void
  inspectorOpen: boolean
  wordWrap: boolean
  onToggleWordWrap: () => void
  autoScroll: boolean
  onToggleAutoScroll: () => void
  tabMode: 'code' | 'ui' | 'split'
  onTabModeChange: (m: 'code' | 'ui' | 'split') => void
}

function vehicleLabel(v: VehicleEntry): string {
  return `#${v.id} \u00b7 ${v.jbeam}${v.player ? ' (player)' : ''}`
}

export function LuaConsoleHeader(p: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [vehMenuOpen, setVehMenuOpen] = useState(false)
  const [reloadMenuOpen, setReloadMenuOpen] = useState(false)
  const vehMenuRef = useRef<HTMLDivElement | null>(null)
  const reloadMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (vehMenuRef.current && !vehMenuRef.current.contains(e.target as Node)) setVehMenuOpen(false)
      if (reloadMenuRef.current && !reloadMenuRef.current.contains(e.target as Node)) setReloadMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const statusLabel = !p.deployed
    ? t('luaConsole.status.notDeployed')
    : p.connected
      ? t('luaConsole.status.connected')
      : t('luaConsole.status.waiting')

  const statusColor = !p.deployed
    ? 'text-[var(--color-text-muted)]'
    : p.connected
      ? 'text-emerald-400'
      : 'text-amber-400'

  const currentVeh = p.vehicles.find((v) => v.id === p.vehId)
  const vehBtnLabel = p.scope === 'veh'
    ? (currentVeh ? vehicleLabel(currentVeh) : (p.vehId == null ? 'player vehicle' : `#${p.vehId} (?)`))
    : '\u2014'

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-scrim-15)] backdrop-blur-md flex-wrap">
      <span className="text-sm font-semibold text-[var(--color-text-primary)]">
        {t('luaConsole.title')}
      </span>
      <span className={`flex items-center gap-1 text-[11px] ${statusColor}`}>
        <CircleDot size={10} />
        {statusLabel}
      </span>

      <div className="ml-3 flex items-center rounded border border-[var(--color-border)] overflow-hidden">
        {(['code', 'ui', 'split'] as const).map((m) => (
          <button
            key={m}
            onClick={() => p.onTabModeChange(m)}
            className={`px-2 py-1 text-[11px] font-medium ${
              p.tabMode === m
                ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
            title={m === 'code' ? 'Lua console only' : m === 'ui' ? 'Dev editor only' : 'Side-by-side split view'}
          >
            {m === 'code' ? 'Lua' : m === 'ui' ? 'Editor' : 'Split'}
          </button>
        ))}
      </div>

      <div className="flex items-center rounded border border-[var(--color-border)] overflow-hidden">
        {(['ge', 'veh'] as const).map((s) => (
          <button
            key={s}
            onClick={() => p.onScopeChange(s)}
            className={`px-2 py-1 text-[11px] font-medium ${
              p.scope === s
                ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
            title={t(`luaConsole.scope.${s}.desc`)}
          >
            {t(`luaConsole.scope.${s}.label`)}
          </button>
        ))}
      </div>

      <div className="relative" ref={vehMenuRef}>
        <button
          onClick={() => { if (p.scope === 'veh') { p.onRefreshVehicles(); setVehMenuOpen((v) => !v) } }}
          disabled={p.scope !== 'veh'}
          className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-[var(--color-border)] ${p.scope === 'veh' ? 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]' : 'text-[var(--color-text-muted)] opacity-50 cursor-not-allowed'}`}
          title="Pick a vehicle to target"
        >
          <Boxes size={12} />
          <span className="truncate max-w-[180px]">{vehBtnLabel}</span>
          <ChevronDown size={10} />
        </button>
        {vehMenuOpen && p.scope === 'veh' && (
          <div className="absolute z-20 top-full left-0 mt-1 w-72 max-h-72 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-scrim-40)] backdrop-blur-md shadow-lg py-1">
            <button
              onClick={() => { p.onVehicleChange(null); setVehMenuOpen(false) }}
              className={`w-full text-left px-3 py-1 text-xs ${p.vehId == null ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'}`}
            >
              Player vehicle (auto)
            </button>
            <div className="my-1 border-t border-[var(--color-border)]" />
            {p.vehicles.length === 0
              ? <div className="px-3 py-2 text-[11px] text-[var(--color-text-muted)] italic">No vehicles found</div>
              : p.vehicles.map((v) => (
                <button
                  key={v.id}
                  onClick={() => { p.onVehicleChange(v.id); setVehMenuOpen(false) }}
                  className={`w-full text-left px-3 py-1 text-xs font-mono ${p.vehId === v.id ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'}`}
                >
                  {vehicleLabel(v)}
                </button>
              ))}
          </div>
        )}
      </div>

      <div className="relative" ref={reloadMenuRef}>
        <button
          onClick={() => setReloadMenuOpen((v) => !v)}
          disabled={!p.deployed || !p.connected}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
          title="Reload Lua"
        >
          <RotateCw size={12} />
          Reload
          <ChevronDown size={10} />
        </button>
        {reloadMenuOpen && (
          <div className="absolute z-50 top-full left-0 mt-1 w-56 rounded border border-[var(--color-border)] bg-[var(--color-scrim-40)] backdrop-blur-md shadow-2xl py-1 text-[var(--color-text-primary)]">
            <button
              onClick={() => { p.onReload('ge'); setReloadMenuOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800"
            >
              Reload GE Lua
            </button>
            <button
              onClick={() => { p.onReload('veh'); setReloadMenuOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800"
            >
              Reload target vehicle
            </button>
            <button
              onClick={() => { p.onReload('env'); setReloadMenuOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800"
            >
              Reload all extensions
            </button>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={p.onToggleInspector}
          className={`p-1.5 rounded text-xs ${p.inspectorOpen ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'}`}
          title="Object inspector"
        >
          <TreePine size={14} />
        </button>
        <button
          onClick={p.onToggleWordWrap}
          className={`p-1.5 rounded text-xs ${p.wordWrap ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'}`}
          title={t('luaConsole.toggleWordWrap')}
        >
          <WrapText size={14} />
        </button>
        <button
          onClick={p.onToggleAutoScroll}
          className={`p-1.5 rounded text-xs ${p.autoScroll ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'}`}
          title={t('luaConsole.toggleAutoScroll')}
        >
          <ArrowDown size={14} />
        </button>
        <button
          onClick={p.onClearOutput}
          className="p-1.5 rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          title={t('luaConsole.clearOutput')}
        >
          <Eraser size={14} />
        </button>
        <button
          onClick={p.onClearRemote}
          className="p-1.5 rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
          title={t('luaConsole.clearRemote')}
        >
          <Trash2 size={14} />
        </button>

        {p.deployed ? (
          <button
            onClick={p.onUndeploy}
            disabled={p.busy}
            className="ml-1 flex items-center gap-1 px-2.5 py-1.5 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            <Power size={12} />
            {t('luaConsole.undeploy')}
          </button>
        ) : (
          <button
            onClick={p.onDeploy}
            disabled={p.busy}
            className="ml-1 flex items-center gap-1 px-2.5 py-1.5 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            <Power size={12} />
            {t('luaConsole.deploy')}
          </button>
        )}

        <button
          onClick={p.onRun}
          disabled={!p.deployed || p.busy}
          className="ml-1 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-[var(--color-accent)] text-black hover:opacity-90 disabled:opacity-40"
          title={t('luaConsole.run')}
        >
          {p.busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          {t('luaConsole.run')}
        </button>
      </div>
    </div>
  )
}
