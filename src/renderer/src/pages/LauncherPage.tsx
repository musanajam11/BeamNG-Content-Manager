import { useState, useEffect, useRef } from 'react'
import { RefreshCw, Trash2, Copy, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function LauncherPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<string[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('')
  const logEndRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchLogs = async (): Promise<void> => {
    const lines = await window.api.getLauncherLogs()
    setLogs(lines)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    fetchLogs()
    const cleanup = window.api.onLauncherLog((line: string) => {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- subscription callback
      setLogs((prev) => {
        const next = [...prev, line]
        return next.length > 2000 ? next.slice(-2000) : next
      })
    })
    return cleanup
  }, [])

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const handleScroll = (): void => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40)
  }

  const filteredLogs = filter
    ? logs.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : logs

  const copyLogs = (): void => {
    navigator.clipboard.writeText(filteredLogs.join('\n'))
  }

  const downloadLogs = (): void => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `beammp-launcher-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const getLineClass = (line: string): string => {
    if (line.includes('ERROR:')) return 'text-red-400'
    if (line.includes('Core ←') || line.includes('Core ←')) return 'text-blue-400'
    if (line.includes('Relay ←') || line.includes('Relay ←')) return 'text-green-400'
    if (line.includes('Handshake') || line.includes('Connected')) return 'text-yellow-400'
    return 'text-[var(--text-secondary)]'
  }

  return (
    <div className="flex flex-col h-full gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">{t('launcher.title')}</h1>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder={t('launcher.filterLogs')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] w-48"
          />
          <button
            onClick={fetchLogs}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
            title={t('common.refresh')}
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={copyLogs}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
            title={t('launcher.copyClipboard')}
          >
            <Copy size={16} />
          </button>
          <button
            onClick={downloadLogs}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
            title={t('launcher.downloadLog')}
          >
            <Download size={16} />
          </button>
          <button
            onClick={() => setLogs([])}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-red-400 transition-colors"
            title={t('launcher.clearDisplay')}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
        <span>{t('launcher.logEntries', { count: logs.length })}</span>
        {filter && <span>{t('launcher.matching', { count: filteredLogs.length })}</span>}
        <label className="flex items-center gap-1.5 ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="rounded"
          />
          {t('launcher.autoScroll')}
        </label>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] font-mono text-xs leading-5 p-3"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-[var(--text-muted)] text-center py-8">
            {t('launcher.noLogs')}
          </div>
        ) : (
          filteredLogs.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all ${getLineClass(line)}`}>
              {line}
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  )
}
