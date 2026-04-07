import { useRef, useEffect, useState, useCallback } from 'react'
import { Send, Trash2, Search, Download, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ConsolePanelProps {
  lines: string[]
  cmdInput: string
  setCmdInput: (v: string) => void
  onSend: () => void
  onClear?: () => void
}

function classifyLine(line: string): string {
  if (line.startsWith('[ERR]') || line.includes('[ERROR]')) return 'text-red-400'
  if (line.includes('[WARN]')) return 'text-yellow-400'
  if (line.includes('[LUA]')) return 'text-cyan-400'
  if (line.includes('[INFO]')) return 'text-blue-400'
  if (line.includes('[DEBUG]')) return 'text-zinc-500'
  return 'text-[var(--color-text-secondary)]'
}

export function ConsolePanel({
  lines,
  cmdInput,
  setCmdInput,
  onSend,
  onClear
}: ConsolePanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [cmdHistory, setCmdHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }, [])

  const handleSend = (): void => {
    if (!cmdInput.trim()) return
    setCmdHistory((prev) => {
      const next = [...prev.filter((c) => c !== cmdInput.trim()), cmdInput.trim()]
      return next.length > 50 ? next.slice(-50) : next
    })
    setHistoryIdx(-1)
    onSend()
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      handleSend()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (cmdHistory.length === 0) return
      const idx = historyIdx === -1 ? cmdHistory.length - 1 : Math.max(0, historyIdx - 1)
      setHistoryIdx(idx)
      setCmdInput(cmdHistory[idx])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIdx === -1) return
      if (historyIdx >= cmdHistory.length - 1) {
        setHistoryIdx(-1)
        setCmdInput('')
      } else {
        const idx = historyIdx + 1
        setHistoryIdx(idx)
        setCmdInput(cmdHistory[idx])
      }
    }
  }

  const exportLog = (): void => {
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `server-console-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = filter
    ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : lines

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <span className="text-xs text-[var(--color-text-muted)] mr-auto">
          {t('serverManager.consoleLines', { count: lines.length })}{filter && ` (${t('serverManager.consoleMatched', { count: filtered.length })})`}
        </span>
        <button
          onClick={() => setShowSearch(!showSearch)}
          className={`p-1.5 rounded transition-colors ${showSearch ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
          title={t('serverManager.consoleSearch')}
        >
          <Search size={14} />
        </button>
        <button
          onClick={exportLog}
          className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          title={t('serverManager.exportLog')}
        >
          <Download size={14} />
        </button>
        <button
          onClick={onClear}
          className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
          title={t('serverManager.clearConsole')}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <Search size={12} className="text-[var(--color-text-muted)] shrink-0" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('serverManager.filterPlaceholder')}
            className="flex-1 text-xs bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
            autoFocus
          />
          {filter && (
            <button onClick={() => setFilter('')} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Console output */}
      <div ref={containerRef} className="flex-1 overflow-auto font-mono text-xs leading-5 p-3 bg-black/40" onScroll={handleScroll}>
        {filtered.length === 0 ? (
          <div className="text-[var(--color-text-muted)] text-center py-8">
            {filter ? t('serverManager.noMatchingLines') : t('serverManager.consoleEmpty')}
          </div>
        ) : (
          filtered.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all ${classifyLine(line)}`}>
              {filter ? highlightMatch(line, filter) : line}
            </div>
          ))
        )}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && lines.length > 0 && (
        <button
          onClick={() => { setAutoScroll(true); if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight }}
          className="mx-auto -mt-8 mb-1 relative z-10 px-3 py-1 rounded-full text-xs bg-[var(--color-accent)] text-white shadow-lg hover:opacity-90 transition-opacity"
        >
          {t('serverManager.scrollToBottom')}
        </button>
      )}

      {/* Command input */}
      <div className="flex border-t border-[var(--color-border)]">
        <span className="pl-3 py-2 text-sm font-mono text-[var(--color-accent)]">{'>'}</span>
        <input
          type="text"
          value={cmdInput}
          onChange={(e) => { setCmdInput(e.target.value); setHistoryIdx(-1) }}
          onKeyDown={handleKeyDown}
          placeholder={t('serverManager.sendCommand')}
          className="flex-1 px-2 py-2 text-sm bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none font-mono"
        />
        <button
          onClick={handleSend}
          className="px-3 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}

function highlightMatch(text: string, query: string): React.ReactNode {
  const lower = text.toLowerCase()
  const qLower = query.toLowerCase()
  const idx = lower.indexOf(qLower)
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-500/30 text-inherit rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}
