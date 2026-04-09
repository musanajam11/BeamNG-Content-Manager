import {
  Users,
  Flame,
  RotateCcw,
  Upload
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface HeatMapToolbarProps {
  playerCount: number
  trackerDeployed: boolean
  showHeatmap: boolean
  onToggleHeatmap: () => void
  onClearHeatmap: () => void
  onDeployTracker: () => void
}

export default function HeatMapToolbar({
  playerCount,
  trackerDeployed,
  showHeatmap,
  onToggleHeatmap,
  onClearHeatmap,
  onDeployTracker
}: HeatMapToolbarProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/10 bg-white/[0.02]">
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
