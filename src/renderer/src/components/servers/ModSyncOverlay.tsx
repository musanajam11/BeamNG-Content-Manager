import { useState, useEffect } from 'react'
import { Download, Loader2, CheckCircle, Package, XCircle } from 'lucide-react'

type ModSyncProgress = {
  phase: 'downloading' | 'loading' | 'done' | 'cancelled'
  modIndex: number
  modCount: number
  fileName: string
  received: number
  total: number
}

type Props = {
  /**
   * When true, the overlay is rendered inside a dedicated always-on-top
   * BrowserWindow that sits on top of BeamNG.drive. In that mode we skip the
   * dark scrim backdrop (the host window is transparent), and we keep the
   * "Mods synced" flash visible until the host window itself is destroyed by
   * the main process, instead of unmounting after 1.5s.
   */
  standalone?: boolean
}

export function ModSyncOverlay({ standalone = false }: Props): React.JSX.Element | null {
  const [progress, setProgress] = useState<ModSyncProgress | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const unsub = window.api.onModSyncProgress((p) => {
      if (p.phase === 'done' || p.phase === 'cancelled') {
        setProgress(p)
        setVisible(true)
        if (!standalone) {
          // In-app overlay: auto-hide after a brief flash so the user sees
          // the final state ("Mods synced" / "Cancelled") before it goes.
          setTimeout(() => { setVisible(false); setProgress(null) }, 1500)
        }
        // Standalone host window will be destroyed by the main process.
      } else {
        setProgress(p)
        setVisible(true)
      }
    })
    // Belt-and-suspenders: if BeamNG stops running for any reason while the
    // overlay is still showing, clear it. This covers edge cases where the
    // synthetic 'cancelled' broadcast from main never reaches us (HMR re-
    // initialisation, multiple shutdown paths, etc.).
    const unsubStatus = window.api.onGameStatusChange((s) => {
      if (!s.running) {
        setVisible(false)
        setProgress(null)
      }
    })
    return () => { unsub(); unsubStatus() }
  }, [standalone])

  if (!visible || !progress) return null

  const isDone = progress.phase === 'done'
  const isCancelled = progress.phase === 'cancelled'
  const isFinal = isDone || isCancelled
  const isDownloading = progress.phase === 'downloading'
  const overallPercent = progress.modCount > 0
    ? Math.round(((progress.modIndex + (isDownloading && progress.total > 0 ? progress.received / progress.total : 1)) / progress.modCount) * 100)
    : 0
  const displayPercent = isDone ? 100 : isCancelled ? overallPercent : Math.min(overallPercent, 99)

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const containerClass = standalone
    ? 'fixed inset-0 z-50 flex items-stretch justify-stretch'
    : 'absolute inset-0 z-50 flex items-center justify-center bg-[var(--color-scrim-80)] backdrop-blur-sm'

  const cardClass = standalone
    ? 'w-full h-full border border-[var(--color-border)] bg-[var(--color-base)]/95 backdrop-blur-md rounded-xl p-8 shadow-2xl flex flex-col items-center justify-center gap-6'
    : 'w-[380px] border border-[var(--color-border)] bg-[var(--color-base)] rounded-lg p-6 shadow-2xl'

  const headlineText = isDone
    ? 'Mods synced'
    : isCancelled
      ? 'Cancelled'
      : 'Syncing server mods'

  const subText = isDone
    ? `${progress.modCount} mod${progress.modCount !== 1 ? 's' : ''} ready — game loading…`
    : isCancelled
      ? 'Download was cancelled'
      : `${progress.modIndex + 1} of ${progress.modCount} — ${isDownloading ? 'Downloading' : 'Loading'}`

  if (standalone) {
    // Big centered ring + percentage — visually prominent, fills the card.
    const ringSize = 220
    const stroke = 14
    const radius = (ringSize - stroke) / 2
    const circumference = 2 * Math.PI * radius
    const dashOffset = circumference * (1 - displayPercent / 100)
    const ringColor = isDone ? '#22c55e' : isCancelled ? '#ef4444' : 'var(--color-accent)'
    const ringTrack = 'var(--color-surface)'

    return (
      <div className={containerClass}>
        <div className={cardClass}>
          {/* Big circular progress with icon + percent in the middle */}
          <div className="relative" style={{ width: ringSize, height: ringSize }}>
            <svg width={ringSize} height={ringSize}>
              <circle
                cx={ringSize / 2}
                cy={ringSize / 2}
                r={radius}
                fill="none"
                stroke={ringTrack}
                strokeWidth={stroke}
              />
              <circle
                cx={ringSize / 2}
                cy={ringSize / 2}
                r={radius}
                fill="none"
                stroke={ringColor}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                style={{ transition: 'stroke-dashoffset 300ms ease-out' }}
              />
            </svg>
            {/* Spinning indicator arc — gives the ring motion even when the
                percentage isn't visibly changing (e.g. during 'loading'). */}
            {!isFinal && (
              <svg
                width={ringSize}
                height={ringSize}
                className="absolute inset-0 modsync-ring-spin"
                style={{ pointerEvents: 'none' }}
              >
                <circle
                  cx={ringSize / 2}
                  cy={ringSize / 2}
                  r={radius}
                  fill="none"
                  stroke={ringColor}
                  strokeOpacity={0.55}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={`${circumference * 0.12} ${circumference}`}
                  transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                />
              </svg>
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {isDone ? (
                <CheckCircle size={40} className="text-green-400 mb-1" />
              ) : isCancelled ? (
                <XCircle size={40} className="text-red-400 mb-1" />
              ) : isDownloading ? (
                <Download size={36} className="text-[var(--color-accent-text)] modsync-icon-bounce mb-1" />
              ) : (
                <Loader2 size={36} className="text-[var(--color-accent-text)] animate-spin mb-1" />
              )}
              <span className="text-4xl font-bold text-[var(--color-text-primary)] tabular-nums leading-none">
                {displayPercent}%
              </span>
            </div>
          </div>

          {/* Headline + subtitle */}
          <div className="text-center">
            <div className="text-2xl font-semibold text-[var(--color-text-primary)]">{headlineText}</div>
            <div className="text-sm text-[var(--color-text-secondary)] mt-1">{subText}</div>
          </div>

          {/* Animated stripe bar (download phase only) */}
          {!isFinal && isDownloading && (
            <div className="relative w-full max-w-[520px] h-3 bg-[var(--color-surface)] rounded-full overflow-hidden">
              <div
                className="relative h-full bg-[var(--color-accent)] rounded-full overflow-hidden transition-all duration-300 ease-out"
                style={{ width: `${displayPercent}%` }}
              >
                <div className="absolute inset-0 modsync-bar-stripes rounded-full" />
                <div className="modsync-bar-shimmer rounded-full" />
              </div>
            </div>
          )}

          {/* Current file */}
          {!isFinal && progress.fileName && (
            <div className="flex items-center gap-2 text-base text-[var(--color-text-secondary)] max-w-[80%]">
              <Package size={16} className="shrink-0" />
              <span className="truncate font-mono">{progress.fileName}</span>
              {isDownloading && progress.total > 0 && (
                <span className="ml-2 shrink-0 text-[var(--color-text-muted)]">
                  {formatSize(progress.received)} / {formatSize(progress.total)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // In-app compact version
  return (
    <div className={containerClass}>
      <div className={cardClass}>
        <div className="flex items-center gap-3 mb-3">
          {isDone ? (
            <CheckCircle size={20} className="text-green-400" />
          ) : isCancelled ? (
            <XCircle size={20} className="text-red-400" />
          ) : isDownloading ? (
            <Download size={20} className="text-[var(--color-accent-text)] animate-pulse" />
          ) : (
            <Loader2 size={20} className="text-[var(--color-accent-text)] animate-spin" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">{headlineText}</div>
            <div className="text-[11px] text-[var(--color-text-secondary)]">{subText}</div>
          </div>
          <span className="ml-auto text-lg font-bold text-[var(--color-text-primary)] tabular-nums">{displayPercent}%</span>
        </div>

        <div className="relative h-2 bg-[var(--color-surface)] rounded-full overflow-hidden mb-2">
          <div
            className={`relative h-full transition-all duration-300 ease-out rounded-full overflow-hidden ${isDone ? 'bg-green-500' : isCancelled ? 'bg-red-500' : 'bg-[var(--color-accent)]'}`}
            style={{ width: `${displayPercent}%` }}
          >
            {!isFinal && isDownloading && (
              <>
                <div className="absolute inset-0 modsync-bar-stripes rounded-full" />
                <div className="modsync-bar-shimmer rounded-full" />
              </>
            )}
          </div>
        </div>

        {!isFinal && progress.fileName && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <Package size={11} className="shrink-0" />
            <span className="truncate font-mono">{progress.fileName}</span>
            {isDownloading && progress.total > 0 && (
              <span className="ml-auto shrink-0 text-[var(--color-text-muted)]">
                {formatSize(progress.received)} / {formatSize(progress.total)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
