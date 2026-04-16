import {
  Users,
  Flame,
  RotateCcw,
  Upload,
  Mic,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface HeatMapToolbarProps {
  playerCount: number
  trackerDeployed: boolean
  voicePluginDeployed: boolean
  showHeatmap: boolean
  onToggleHeatmap: () => void
  onClearHeatmap: () => void
  onDeployTracker: () => void
  onUndeployTracker: () => void
  onDeployVoicePlugin: () => void
  onUndeployVoicePlugin: () => void
}

export default function HeatMapToolbar({
  playerCount,
  trackerDeployed,
  voicePluginDeployed,
  showHeatmap,
  onToggleHeatmap,
  onClearHeatmap,
  onDeployTracker,
  onUndeployTracker,
  onDeployVoicePlugin,
  onUndeployVoicePlugin
}: HeatMapToolbarProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* ── Heatmap toggle ──────────────────────────── */}
      <button
        onClick={onToggleHeatmap}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
          showHeatmap
            ? 'bg-[var(--color-accent-20)] text-[var(--color-accent-text)] border-[var(--color-border-accent)]'
            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] border-[var(--color-border)]'
        }`}
        title={t('serverManager.toggleHeatmap')}
      >
        <Flame size={13} /> {t('serverManager.heatmap')}
      </button>

      {showHeatmap && (
        <button
          onClick={onClearHeatmap}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] transition-colors"
          title={t('serverManager.clearHeatmapData')}
        >
          <RotateCcw size={12} />
        </button>
      )}

      {/* ── Spacer ──────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Player count ────────────────────────────── */}
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
        <Users size={13} />
        <span>
          {t('serverManager.playerCount_other', { count: playerCount })}
        </span>
      </div>

      {/* ── Deploy / Undeploy tracker ──────────────────── */}
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
        <button
          onClick={onUndeployTracker}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-300 hover:bg-red-500/15 hover:text-red-300 border border-emerald-500/20 hover:border-red-500/20 transition-colors group"
          title={t('serverManager.undeployTrackerTooltip')}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse group-hover:bg-red-400 group-hover:animate-none" />
          <span className="group-hover:hidden">{t('serverManager.trackerActive')}</span>
          <span className="hidden group-hover:inline"><Trash2 size={13} className="inline mr-1" />{t('serverManager.undeployTracker')}</span>
        </button>
      )}

      {/* ── Deploy / Undeploy voice plugin ─────────────── */}
      {!voicePluginDeployed && (
        <button
          onClick={onDeployVoicePlugin}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 border border-violet-500/20 transition-colors"
          title={t('serverManager.deployVoicePluginTooltip')}
        >
          <Mic size={13} /> {t('serverManager.deployVoicePlugin')}
        </button>
      )}
      {voicePluginDeployed && (
        <button
          onClick={onUndeployVoicePlugin}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-300 hover:bg-red-500/15 hover:text-red-300 border border-emerald-500/20 hover:border-red-500/20 transition-colors group"
          title={t('serverManager.undeployVoicePluginTooltip')}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse group-hover:bg-red-400 group-hover:animate-none" />
          <span className="group-hover:hidden">{t('serverManager.voicePluginActive')}</span>
          <span className="hidden group-hover:inline"><Trash2 size={13} className="inline mr-1" />{t('serverManager.undeployVoicePlugin')}</span>
        </button>
      )}
    </div>
  )
}
