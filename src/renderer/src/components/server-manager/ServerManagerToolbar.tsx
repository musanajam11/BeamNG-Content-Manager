import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, Download, FolderOpen, Play, Square, ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BeamMPText } from '../BeamMPText'
import type { ServerExeStatus } from '../../../../shared/types'

interface ServerManagerToolbarProps {
  exeStatus: ServerExeStatus
  viewMode: 'grid' | 'detail'
  serverName?: string
  hasServers: boolean
  onCreate: () => void
  onDownloadExe: () => void
  onBrowseExe: () => void
  onInstallExe: (path: string) => Promise<void>
  onStartAll: () => void
  onStopAll: () => void
  onBackToGrid: () => void
}

export function ServerManagerToolbar({
  exeStatus,
  viewMode,
  serverName,
  hasServers,
  onCreate,
  onDownloadExe,
  onBrowseExe,
  onInstallExe,
  onStartAll,
  onStopAll,
  onBackToGrid
}: ServerManagerToolbarProps): React.JSX.Element {
  const { t } = useTranslation()
  const [dragOver, setDragOver] = useState(false)

  // Marquee: detect if server name overflows its container
  const containerRef = useRef<HTMLHeadingElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  const checkOverflow = useCallback(() => {
    const container = containerRef.current
    const text = textRef.current
    if (!container || !text) return
    const overflow = text.scrollWidth > container.clientWidth
    setIsOverflowing(overflow)
    if (overflow) {
      text.style.setProperty('--marquee-offset', `${container.clientWidth - text.scrollWidth}px`)
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => checkOverflow())
    ro.observe(container)
    checkOverflow()
    return () => ro.disconnect()
  }, [serverName, viewMode, checkOverflow])

  const handleExeDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const name = file.name.toLowerCase()
    if (name.includes('beammp-server') || name.endsWith('.exe')) {
      await onInstallExe((file as File & { path: string }).path)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Exe missing banner — shown globally when exe not available */}
      {exeStatus !== 'ready' && (
        <div
          className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border transition-colors ${
            exeStatus === 'downloading'
              ? 'bg-yellow-500/10 border-yellow-500/30'
              : dragOver
                ? 'bg-[var(--color-accent-20)] border-[var(--color-accent)]'
                : 'bg-[var(--color-accent-10)] border-[var(--color-border-accent)]'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleExeDrop}
        >
          <Download size={16} className={exeStatus === 'downloading' ? 'text-yellow-400 animate-pulse' : 'text-[var(--color-accent)]'} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">
              {exeStatus === 'downloading' ? t('serverManager.downloading') : t('serverManager.exeNotFound')}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {exeStatus === 'downloading'
                ? t('serverManager.downloadDesc')
                : t('serverManager.exeMissingDesc')}
            </p>
          </div>
          {exeStatus === 'missing' && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={onDownloadExe}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--color-accent)] text-white font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
              >
                <Download size={12} /> {t('serverManager.download')}
              </button>
              <button
                onClick={onBrowseExe}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <FolderOpen size={12} /> {t('serverManager.browseExe')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main toolbar row */}
      <div className="flex items-center justify-between gap-4">
        {/* Left: title or back nav */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {viewMode === 'detail' ? (
            <>
              <button
                onClick={onBackToGrid}
                className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline shrink-0"
              >
                <ArrowLeft size={14} />
                {t('serverManager.instances')}
              </button>
              <span className="text-[var(--color-text-muted)] shrink-0">/</span>
              <h1 ref={containerRef} className="text-lg font-bold text-[var(--color-text-primary)] min-w-0 flex-1 overflow-hidden">
                <span ref={textRef} className={`marquee-scroll${isOverflowing ? ' is-overflowing' : ''}`}>
                  <BeamMPText text={serverName ?? 'Server'} className="whitespace-nowrap" />
                </span>
              </h1>
            </>
          ) : (
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('serverManager.title')}</h1>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          {/* Batch actions (grid view only) */}
          {viewMode === 'grid' && hasServers && (
            <>
              <button
                onClick={onStartAll}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors"
              >
                <Play size={12} /> {t('serverManager.startAll')}
              </button>
              <button
                onClick={onStopAll}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Square size={12} /> {t('serverManager.stopAll')}
              </button>
            </>
          )}
          <button
            onClick={onCreate}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--color-accent)] text-black font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            <Plus size={14} /> {t('serverManager.createInstance')}
          </button>
        </div>
      </div>
    </div>
  )
}
