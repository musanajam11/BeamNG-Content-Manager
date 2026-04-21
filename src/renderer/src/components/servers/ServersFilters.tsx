import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, ArrowUpDown, SlidersHorizontal, Tags, X, Check, Globe2, CircleDot } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useServerStore } from '../../stores/useServerStore'
import type { SortField, SortDir, FilterTab, QuickFilter } from '../../stores/useServerStore'
import { parseServerTags } from '../../utils/serverTags'
import { regionName } from '../../utils/countryFlags'

const TAB_KEYS: FilterTab[] = ['all', 'favorites', 'official', 'modded']
const TAB_I18N: Record<FilterTab, string> = {
  all: 'servers.tabAll',
  favorites: 'servers.tabFavorites',
  official: 'servers.tabOfficial',
  modded: 'servers.tabModded'
}

const SORT_KEYS: SortField[] = ['players', 'name', 'map', 'location']
const SORT_I18N: Record<SortField, string> = {
  players: 'servers.sortPlayers',
  name: 'servers.sortName',
  map: 'servers.sortMap',
  location: 'servers.sortRegion'
}

const QF_KEYS: QuickFilter[] = ['hideEmpty', 'hideFull', 'officialOnly', 'moddedOnly']
const QF_I18N: Record<QuickFilter, string> = {
  hideEmpty: 'servers.hideEmpty',
  hideFull: 'servers.hideFull',
  officialOnly: 'servers.officialOnly',
  moddedOnly: 'servers.moddedOnly'
}

interface Props {
  filterTab: FilterTab
  sortField: SortField
  sortDir: SortDir
  quickFilters: Set<QuickFilter>
  onFilterTab: (tab: FilterTab) => void
  onSort: (field: SortField) => void
  onToggleQuickFilter: (filter: QuickFilter) => void
}

export function ServersFilters({
  filterTab,
  sortField,
  sortDir,
  quickFilters,
  onFilterTab,
  onSort,
  onToggleQuickFilter
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  const servers = useServerStore((s) => s.servers)
  const regionFilter = useServerStore((s) => s.regionFilter)
  const versionFilter = useServerStore((s) => s.versionFilter)
  const tagFilters = useServerStore((s) => s.tagFilters)
  const setRegionFilter = useServerStore((s) => s.setRegionFilter)
  const setVersionFilter = useServerStore((s) => s.setVersionFilter)
  const toggleTagFilter = useServerStore((s) => s.toggleTagFilter)
  const clearTagFilters = useServerStore((s) => s.clearTagFilters)

  // ── Derived option lists ──────────────────────────────────────────────
  const regions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of servers) {
      if (!s.location || s.tags === 'offline') continue
      counts.set(s.location, (counts.get(s.location) || 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, count]) => ({ code, count }))
  }, [servers])

  const versions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of servers) {
      if (!s.version || s.tags === 'offline') continue
      counts.set(s.version, (counts.get(s.version) || 0) + 1)
    }
    // Newest versions first (rough semver sort, falling back to string compare)
    return [...counts.entries()]
      .sort((a, b) => {
        const ap = a[0].split('.').map((n) => parseInt(n, 10) || 0)
        const bp = b[0].split('.').map((n) => parseInt(n, 10) || 0)
        for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
          const diff = (bp[i] || 0) - (ap[i] || 0)
          if (diff !== 0) return diff
        }
        return a[0].localeCompare(b[0])
      })
      .map(([ver, count]) => ({ ver, count }))
  }, [servers])

  const tagOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>()
    for (const s of servers) {
      if (s.tags === 'offline') continue
      for (const tag of parseServerTags(s.tags)) {
        if (tag.category === 'unknown') continue
        const key = tag.label.toLowerCase()
        const cur = counts.get(key)
        if (cur) cur.count += 1
        else counts.set(key, { label: tag.label, count: 1 })
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }, [servers])

  // ── Tags popover ──────────────────────────────────────────────────────
  const [tagsOpen, setTagsOpen] = useState(false)
  const tagsRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!tagsOpen) return
    const onClick = (ev: MouseEvent): void => {
      if (tagsRef.current && !tagsRef.current.contains(ev.target as Node)) setTagsOpen(false)
    }
    const onKey = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') setTagsOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [tagsOpen])

  const [tagSearch, setTagSearch] = useState('')
  const filteredTagOptions = useMemo(() => {
    const q = tagSearch.trim().toLowerCase()
    if (!q) return tagOptions
    return tagOptions.filter((t) => t.label.toLowerCase().includes(q))
  }, [tagOptions, tagSearch])

  return (
    <div className="space-y-2">
      {/* Filter tabs + sort row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TAB_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => onFilterTab(key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filterTab === key
                ? 'bg-[var(--color-text-primary)] text-[var(--color-base)] shadow-sm'
                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {t(TAB_I18N[key])}
          </button>
        ))}

        <div className="mx-1 h-4 w-px bg-[var(--color-surface-active)]" />

        {SORT_KEYS.map((key) => {
          const active = sortField === key
          return (
            <button
              key={key}
              onClick={() => onSort(key)}
              className={`inline-flex items-center gap-0.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                active
                  ? 'bg-[var(--color-accent-15)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {t(SORT_I18N[key])}
              {active
                ? sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
                : <ArrowUpDown size={9} />
              }
            </button>
          )
        })}
      </div>

      {/* Quick filters + dropdowns + tag popover row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <SlidersHorizontal size={11} className="text-[var(--color-text-secondary)]" />
        <span className="text-[11px] text-[var(--color-text-secondary)] mr-0.5">{t('servers.quickFilters')}</span>

        {QF_KEYS.map((key) => {
          const active = quickFilters.has(key)
          return (
            <button
              key={key}
              onClick={() => onToggleQuickFilter(key)}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-medium transition ${
                active
                  ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-15)] text-[var(--color-accent-text-muted)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {t(QF_I18N[key])}
            </button>
          )
        })}

        {/* Region dropdown */}
        <label
          role="button"
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
            regionFilter
              ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-15)] text-[var(--color-accent-text-muted)]'
              : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
          }`}
        >
          <Globe2 size={11} />
          <span>{t('servers.regionFilter')}</span>
          <select
            value={regionFilter ?? ''}
            onChange={(e) => setRegionFilter(e.target.value || null)}
            className="bg-transparent text-[10px] font-medium outline-none cursor-pointer"
          >
            <option value="">{t('servers.allRegions')}</option>
            {regions.map((r) => (
              <option key={r.code} value={r.code}>
                {regionName(r.code)} ({r.count})
              </option>
            ))}
          </select>
        </label>

        {/* Version dropdown */}
        <label
          role="button"
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
            versionFilter
              ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-15)] text-[var(--color-accent-text-muted)]'
              : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
          }`}
        >
          <CircleDot size={11} />
          <span>{t('servers.versionFilter')}</span>
          <select
            value={versionFilter ?? ''}
            onChange={(e) => setVersionFilter(e.target.value || null)}
            className="bg-transparent text-[10px] font-medium outline-none cursor-pointer"
          >
            <option value="">{t('servers.allVersions')}</option>
            {versions.map((v) => (
              <option key={v.ver} value={v.ver}>
                v{v.ver} ({v.count})
              </option>
            ))}
          </select>
        </label>

        {/* Tags popover */}
        <div className="relative" ref={tagsRef}>
          <button
            onClick={() => setTagsOpen((o) => !o)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
              tagFilters.size > 0
                ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-15)] text-[var(--color-accent-text-muted)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Tags size={11} />
            <span>{t('servers.tagsFilter')}</span>
            {tagFilters.size > 0 && (
              <span className="ml-0.5 rounded-full bg-[var(--color-accent-subtle)] px-1.5 py-[1px] text-[9px] font-semibold text-[var(--color-accent-text-muted)]">
                {tagFilters.size}
              </span>
            )}
            {tagsOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>

          {tagsOpen && (
            <div className="absolute z-30 mt-1 w-72 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
              <div className="flex items-center gap-1 border-b border-[var(--color-border)] p-2">
                <input
                  type="text"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  placeholder={t('servers.tagsSearchPlaceholder')}
                  className="flex-1 rounded bg-[var(--color-base)] px-2 py-1 text-[11px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                />
                {tagFilters.size > 0 && (
                  <button
                    onClick={clearTagFilters}
                    title={t('servers.clearTags')}
                    className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    <X size={10} />
                    {t('servers.clearTags')}
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto p-1">
                {filteredTagOptions.length === 0 ? (
                  <div className="px-2 py-3 text-center text-[11px] text-[var(--color-text-muted)]">
                    {t('servers.tagsNone')}
                  </div>
                ) : (
                  filteredTagOptions.map((opt) => {
                    const active = tagFilters.has(opt.label.toLowerCase())
                    return (
                      <button
                        key={opt.label}
                        onClick={() => toggleTagFilter(opt.label)}
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] transition ${
                          active
                            ? 'bg-[var(--color-accent-15)] text-[var(--color-text-primary)]'
                            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                        }`}
                      >
                        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                          active
                            ? 'border-[var(--color-border-accent)] bg-[var(--color-accent)]'
                            : 'border-[var(--color-border)]'
                        }`}>
                          {active && <Check size={9} className="text-[var(--color-base)]" />}
                        </span>
                        <span className="flex-1 truncate">{opt.label}</span>
                        <span className="text-[10px] text-[var(--color-text-muted)]">{opt.count}</span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}