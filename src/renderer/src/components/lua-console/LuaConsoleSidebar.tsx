import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History, Bookmark, Play, Trash2, FilePlus2 } from 'lucide-react'
import type { HistoryEntry, LuaSnippet } from './luaConsoleShared'

interface Props {
  tab: 'history' | 'snippets'
  onTabChange: (t: 'history' | 'snippets') => void
  history: HistoryEntry[]
  snippets: LuaSnippet[]
  onReplay: (src: string) => void
  onRunHistory: (src: string) => void
  onInsertSnippet: (code: string) => void
  onClearHistory: () => void
}

function timeAgo(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function LuaConsoleSidebar(p: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')

  const historyFiltered = p.history.filter(
    (h) => !filter || h.source.toLowerCase().includes(filter.toLowerCase())
  )
  const snippetsFiltered = p.snippets.filter(
    (s) =>
      !filter ||
      s.label.toLowerCase().includes(filter.toLowerCase()) ||
      s.description.toLowerCase().includes(filter.toLowerCase()) ||
      s.code.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <aside className="w-64 shrink-0 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-scrim-10)] backdrop-blur-sm min-h-0">
      <div className="flex items-center border-b border-[var(--color-border)]">
        <button
          onClick={() => p.onTabChange('history')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-medium ${
            p.tab === 'history'
              ? 'text-[var(--color-accent-text-muted)] border-b-2 border-[var(--color-accent)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] border-b-2 border-transparent'
          }`}
        >
          <History size={12} />
          {t('luaConsole.tab.history')}
        </button>
        <button
          onClick={() => p.onTabChange('snippets')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-medium ${
            p.tab === 'snippets'
              ? 'text-[var(--color-accent-text-muted)] border-b-2 border-[var(--color-accent)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] border-b-2 border-transparent'
          }`}
        >
          <Bookmark size={12} />
          {t('luaConsole.tab.snippets')}
        </button>
      </div>

      <div className="px-2 py-2 border-b border-[var(--color-border)] flex items-center gap-1">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('luaConsole.filterPlaceholder')}
          className="flex-1 px-2 py-1 text-[11px] rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
        {p.tab === 'history' && p.history.length > 0 && (
          <button
            onClick={p.onClearHistory}
            className="p-1 rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-red-400"
            title={t('luaConsole.clearHistory')}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {p.tab === 'history' ? (
          historyFiltered.length === 0 ? (
            <div className="text-[var(--color-text-muted)] italic text-[11px] py-4 px-3 text-center">
              {t('luaConsole.noHistory')}
            </div>
          ) : (
            historyFiltered.map((h) => (
              <div
                key={h.id}
                className="group px-2 py-1.5 border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surface-hover)]"
              >
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">
                    {h.scope} · {timeAgo(h.at)}
                  </span>
                  <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => p.onReplay(h.source)}
                      className="p-0.5 rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]"
                      title={t('luaConsole.loadIntoEditor')}
                    >
                      <FilePlus2 size={10} />
                    </button>
                    <button
                      onClick={() => p.onRunHistory(h.source)}
                      className="p-0.5 rounded text-[var(--color-accent-text-muted)] hover:bg-[var(--color-surface)]"
                      title={t('luaConsole.runAgain')}
                    >
                      <Play size={10} />
                    </button>
                  </div>
                </div>
                <pre className="m-0 text-[10px] font-mono whitespace-pre-wrap break-words text-[var(--color-text-secondary)] line-clamp-3">
                  {h.source}
                </pre>
              </div>
            ))
          )
        ) : (
          snippetsFiltered.map((s) => (
            <div
              key={s.id}
              className="group px-2 py-1.5 border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surface-hover)]"
            >
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-medium text-[var(--color-text-primary)]">
                  {s.label}
                </span>
                <button
                  onClick={() => p.onInsertSnippet(s.code)}
                  className="ml-auto p-0.5 rounded text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--color-surface)] hover:text-[var(--color-accent-text-muted)]"
                  title={t('luaConsole.insertSnippet')}
                >
                  <FilePlus2 size={10} />
                </button>
              </div>
              <p className="text-[10px] text-[var(--color-text-muted)] mb-1">{s.description}</p>
              <pre className="m-0 text-[10px] font-mono whitespace-pre-wrap break-words text-[var(--color-text-secondary)] line-clamp-3">
                {s.code}
              </pre>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
