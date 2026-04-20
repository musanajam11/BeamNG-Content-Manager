import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import type { OutputEntry } from './luaConsoleShared'

interface Props {
  entries: OutputEntry[]
  filter: 'all' | 'log' | 'print' | 'result' | 'err'
  onFilterChange: (f: Props['filter']) => void
  search: string
  onSearchChange: (s: string) => void
  autoScroll: boolean
  wordWrap: boolean
  /** Called when the user clicks a "lua/.../foo.lua:42" reference. */
  onSourceLink?: (file: string, line: number) => void
}

const FILTERS: Array<Props['filter']> = ['all', 'result', 'err', 'log', 'print']

function formatTime(at: number): string {
  const d = new Date(at)
  return d.toLocaleTimeString('en-GB', { hour12: false })
}

function kindClasses(kind: OutputEntry['kind'], level?: OutputEntry['level']): string {
  if (kind === 'err' || level === 'E') return 'text-red-400'
  if (kind === 'result') return 'text-emerald-300'
  if (kind === 'query') return 'text-[var(--color-accent-text-muted)]'
  if (kind === 'system') return 'text-[var(--color-text-muted)] italic'
  if (kind === 'print') return 'text-sky-300'
  if (level === 'W') return 'text-amber-300'
  if (level === 'D') return 'text-[var(--color-text-muted)]'
  return 'text-[var(--color-text-secondary)]'
}

function kindBadge(kind: OutputEntry['kind'], level?: OutputEntry['level']): string {
  if (kind === 'query') return '>'
  if (kind === 'result') return '='
  if (kind === 'err') return '!'
  if (kind === 'system') return '~'
  if (kind === 'print') return 'P'
  if (kind === 'log') return level ?? 'L'
  return '*'
}

// Match Lua-style source refs: e.g.  lua/ge/extensions/foo.lua:123
//                                    [string "..."]:12
//                                    foo.lua:42:
const SOURCE_LINK_RE = /([\w./\\-]+\.lua):(\d+)/g

interface RenderedSegment {
  type: 'text' | 'link'
  text: string
  file?: string
  line?: number
}

function splitForLinks(text: string): RenderedSegment[] {
  const out: RenderedSegment[] = []
  let lastIndex = 0
  for (const m of text.matchAll(SOURCE_LINK_RE)) {
    const start = m.index ?? 0
    if (start > lastIndex) out.push({ type: 'text', text: text.slice(lastIndex, start) })
    out.push({ type: 'link', text: m[0], file: m[1], line: parseInt(m[2], 10) })
    lastIndex = start + m[0].length
  }
  if (lastIndex < text.length) out.push({ type: 'text', text: text.slice(lastIndex) })
  return out
}

export function LuaConsoleOutput(p: Props): React.JSX.Element {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const filtered = useMemo(() => {
    const q = p.search.trim().toLowerCase()
    return p.entries.filter((e) => {
      if (p.filter !== 'all') {
        if (p.filter === 'result' && e.kind !== 'result') return false
        if (p.filter === 'err' && e.kind !== 'err') return false
        if (p.filter === 'log' && e.kind !== 'log') return false
        if (p.filter === 'print' && e.kind !== 'print') return false
      }
      if (!q) return true
      return (
        e.text.toLowerCase().includes(q) ||
        (e.source ?? '').toLowerCase().includes(q)
      )
    })
  }, [p.entries, p.filter, p.search])

  useEffect(() => {
    if (!p.autoScroll) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [filtered, p.autoScroll])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--color-scrim-10)] backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-scrim-15)] backdrop-blur-sm">
        <div className="flex items-center rounded border border-[var(--color-border)] overflow-hidden">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => p.onFilterChange(f)}
              className={`px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                p.filter === f
                  ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              {t(`luaConsole.filter.${f}`)}
            </button>
          ))}
        </div>
        <div className="flex-1 relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={p.search}
            onChange={(e) => p.onSearchChange(e.target.value)}
            placeholder={t('luaConsole.searchPlaceholder')}
            className="w-full pl-7 pr-2 py-1 text-xs rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {t('luaConsole.entryCount', { count: filtered.length, total: p.entries.length })}
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto font-mono text-[12px] leading-snug px-3 py-2"
      >
        {filtered.length === 0 ? (
          <div className="text-[var(--color-text-muted)] italic text-xs py-6 text-center">
            {t('luaConsole.empty')}
          </div>
        ) : (
          filtered.map((e) => {
            const segments = splitForLinks(e.text)
            return (
              <div key={e.id} className="flex gap-2 py-0.5">
                <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 select-none mt-0.5 tabular-nums">
                  {formatTime(e.at)}
                </span>
                <span className={`shrink-0 select-none mt-0.5 w-4 text-center ${kindClasses(e.kind, e.level)}`}>
                  {kindBadge(e.kind, e.level)}
                </span>
                <pre
                  className={`flex-1 m-0 ${p.wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto'} ${kindClasses(e.kind, e.level)}`}
                >
                  {segments.map((seg, i) =>
                    seg.type === 'link' && seg.file && seg.line && p.onSourceLink ? (
                      <button
                        key={i}
                        type="button"
                        onClick={() => p.onSourceLink?.(seg.file!, seg.line!)}
                        className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-accent-text-muted)] cursor-pointer"
                        title={`Open ${seg.file}:${seg.line}`}
                      >
                        {seg.text}
                      </button>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    )
                  )}
                </pre>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
