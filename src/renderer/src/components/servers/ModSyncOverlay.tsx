import { useState, useEffect } from 'react'
import { Download, Loader2, CheckCircle, Package } from 'lucide-react'

type ModSyncProgress = {
  phase: 'downloading' | 'loading' | 'done'
  modIndex: number
  modCount: number
  fileName: string
  received: number
  total: number
}

export function ModSyncOverlay(): React.JSX.Element | null {
  const [progress, setProgress] = useState<ModSyncProgress | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const unsub = window.api.onModSyncProgress((p) => {
      if (p.phase === 'done') {
        setProgress({ ...p, phase: 'done' })
        // Auto-hide after a brief flash
        setTimeout(() => { setVisible(false); setProgress(null) }, 1500)
      } else {
        setProgress(p)
        setVisible(true)
      }
    })
    return unsub
  }, [])

  if (!visible || !progress) return null

  const isDone = progress.phase === 'done'
  const isDownloading = progress.phase === 'downloading'
  const overallPercent = progress.modCount > 0
    ? Math.round(((progress.modIndex + (isDownloading && progress.total > 0 ? progress.received / progress.total : 1)) / progress.modCount) * 100)
    : 0
  const displayPercent = isDone ? 100 : Math.min(overallPercent, 99)

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#111113]/90 backdrop-blur-sm">
      <div className="w-[380px] border border-white/10 bg-[#1a1a1e] rounded-lg p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          {isDone ? (
            <CheckCircle size={20} className="text-green-400" />
          ) : isDownloading ? (
            <Download size={20} className="text-[var(--color-accent-text)] animate-pulse" />
          ) : (
            <Loader2 size={20} className="text-[var(--color-accent-text)] animate-spin" />
          )}
          <div>
            <div className="text-sm font-semibold text-white">
              {isDone ? 'Mods synced' : 'Syncing server mods'}
            </div>
            <div className="text-[11px] text-slate-400">
              {isDone
                ? `${progress.modCount} mod${progress.modCount !== 1 ? 's' : ''} ready`
                : `${progress.modIndex + 1} of ${progress.modCount} — ${isDownloading ? 'Downloading' : 'Loading'}`}
            </div>
          </div>
          <span className="ml-auto text-lg font-bold text-white tabular-nums">{displayPercent}%</span>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-3">
          <div
            className={`h-full transition-all duration-300 ease-out rounded-full ${isDone ? 'bg-green-500' : 'bg-[var(--color-accent)]'}`}
            style={{ width: `${displayPercent}%` }}
          />
        </div>

        {/* Current file */}
        {!isDone && progress.fileName && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Package size={11} className="shrink-0" />
            <span className="truncate font-mono">{progress.fileName}</span>
            {isDownloading && progress.total > 0 && (
              <span className="ml-auto shrink-0 text-slate-500">
                {formatSize(progress.received)} / {formatSize(progress.total)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
