import {
  Eye,
  Crosshair,
  Plus,
  Trash2,
  Upload,
  Users,
  Palette,
  Flame,
  RotateCcw
} from 'lucide-react'
import type { GPSRoute } from '../../../../shared/types'
import { useTranslation } from 'react-i18next'

interface HeatMapToolbarProps {
  routes: GPSRoute[]
  selectedRouteId: string | null
  mode: 'view' | 'plot'
  playerCount: number
  trackerDeployed: boolean
  showHeatmap: boolean
  onToggleHeatmap: () => void
  onClearHeatmap: () => void
  onSelectRoute: (id: string | null) => void
  onCreateRoute: () => void
  onDeleteRoute: (id: string) => void
  onModeChange: (mode: 'view' | 'plot') => void
  onDeployTracker: () => void
  onColorChange: (routeId: string, color: string) => void
}

export default function HeatMapToolbar({
  routes,
  selectedRouteId,
  mode,
  playerCount,
  trackerDeployed,
  showHeatmap,
  onToggleHeatmap,
  onClearHeatmap,
  onSelectRoute,
  onCreateRoute,
  onDeleteRoute,
  onModeChange,
  onDeployTracker,
  onColorChange
}: HeatMapToolbarProps): React.JSX.Element {
  const selectedRoute = routes.find((r) => r.id === selectedRouteId)
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/10 bg-white/[0.02]">
      {/* ── Mode toggle ─────────────────────────────── */}
      <div className="flex rounded-lg overflow-hidden border border-white/10">
        <button
          onClick={() => onModeChange('view')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === 'view'
              ? 'bg-white/10 text-white'
              : 'text-white/50 hover:text-white/70 hover:bg-white/5'
          }`}
        >
          <Eye size={13} /> {t('serverManager.viewMode')}
        </button>
        <button
          onClick={() => onModeChange('plot')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === 'plot'
              ? 'bg-indigo-500/30 text-indigo-300 border-l border-indigo-500/40'
              : 'text-white/50 hover:text-white/70 hover:bg-white/5 border-l border-white/10'
          }`}
        >
          <Crosshair size={13} /> {t('serverManager.plotRoute')}
        </button>
      </div>

      {/* ── Divider ─────────────────────────────────── */}
      <div className="w-px h-5 bg-white/10" />

      {/* ── Route selector ──────────────────────────── */}
      <select
        value={selectedRouteId ?? ''}
        onChange={(e) => onSelectRoute(e.target.value || null)}
        className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white/80 outline-none focus:border-white/20 max-w-[180px]"
      >
        <option value="">{t('serverManager.noRouteSelected')}</option>
        {routes.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} ({r.waypoints.length} pts)
          </option>
        ))}
      </select>

      <button
        onClick={onCreateRoute}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white/60 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
        title={t('serverManager.newRoute')}
      >
        <Plus size={13} />
      </button>

      {selectedRouteId && (
        <>
          <button
            onClick={() => onDeleteRoute(selectedRouteId)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-400/70 hover:text-red-400 hover:bg-red-500/10 border border-white/10 transition-colors"
            title={t('serverManager.deleteRoute')}
          >
            <Trash2 size={13} />
          </button>

          {/* Color picker */}
          <label className="flex items-center gap-1.5 cursor-pointer" title={t('serverManager.routeColor')}>
            <Palette size={13} className="text-white/40" />
            <input
              type="color"
              value={selectedRoute?.color ?? '#00ff88'}
              onChange={(e) => onColorChange(selectedRouteId, e.target.value)}
              className="w-5 h-5 rounded border-0 bg-transparent cursor-pointer [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded"
            />
          </label>
        </>
      )}

      {/* ── Divider ─────────────────────────────────── */}
      <div className="w-px h-5 bg-white/10" />

      {/* ── Heatmap toggle ──────────────────────────── */}
      <button
        onClick={onToggleHeatmap}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
          showHeatmap
            ? 'bg-[var(--color-accent-20)] text-[var(--color-accent-text)] border-[var(--color-border-accent)]'
            : 'text-white/50 hover:text-white/70 hover:bg-white/5 border-white/10'
        }`}
        title={t('serverManager.toggleHeatmap')}
      >
        <Flame size={13} /> {t('serverManager.heatmap')}
      </button>

      {showHeatmap && (
        <button
          onClick={onClearHeatmap}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-white/40 hover:text-white/70 hover:bg-white/5 border border-white/10 transition-colors"
          title={t('serverManager.clearHeatmapData')}
        >
          <RotateCcw size={12} />
        </button>
      )}

      {/* ── Spacer ──────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Player count ────────────────────────────── */}
      <div className="flex items-center gap-1.5 text-xs text-white/50">
        <Users size={13} />
        <span>
          {t('serverManager.playerCount_other', { count: playerCount })}
        </span>
      </div>

      {/* ── Deploy tracker ──────────────────────────── */}
      {!trackerDeployed && (
        <button
          onClick={onDeployTracker}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25 border border-indigo-500/20 transition-colors"
          title={t('serverManager.deployTrackerTooltip')}
        >
          <Upload size={13} /> {t('serverManager.deployTracker')}
        </button>
      )}
      {trackerDeployed && (
        <span className="text-xs text-emerald-400/70 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {t('serverManager.trackerActive')}
        </span>
      )}
    </div>
  )
}
