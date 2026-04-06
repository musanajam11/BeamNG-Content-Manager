import { ChevronUp, ChevronDown, ArrowUpDown, SlidersHorizontal } from 'lucide-react'
import type { SortField, SortDir, FilterTab, QuickFilter } from '../../stores/useServerStore'

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'official', label: 'Official' },
  { key: 'modded', label: 'Modded' }
]

const SORTS: { key: SortField; label: string }[] = [
  { key: 'players', label: 'Players' },
  { key: 'name', label: 'Name' },
  { key: 'map', label: 'Map' },
  { key: 'location', label: 'Region' }
]

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: 'hideEmpty', label: 'Hide empty' },
  { key: 'hideFull', label: 'Hide full' },
  { key: 'officialOnly', label: 'Official only' },
  { key: 'moddedOnly', label: 'Modded only' },
  { key: 'noPassword', label: 'No password' }
]

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
  return (
    <div className="space-y-2">
      {/* Filter tabs + sort row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onFilterTab(t.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filterTab === t.key
                ? 'bg-white text-slate-950 shadow-sm'
                : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}

        <div className="mx-1 h-4 w-px bg-white/10" />

        {SORTS.map((s) => {
          const active = sortField === s.key
          return (
            <button
              key={s.key}
              onClick={() => onSort(s.key)}
              className={`inline-flex items-center gap-0.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                active
                  ? 'bg-[var(--color-accent-15)] text-white'
                  : 'text-slate-400 hover:bg-white/8 hover:text-slate-200'
              }`}
            >
              {s.label}
              {active
                ? sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
                : <ArrowUpDown size={9} />
              }
            </button>
          )
        })}
      </div>

      {/* Quick filters row */}
      <div className="flex items-center gap-1.5">
        <SlidersHorizontal size={11} className="text-slate-400" />
        <span className="text-[11px] text-slate-400 mr-0.5">Quick filters</span>
        {QUICK_FILTERS.map((qf) => {
          const active = quickFilters.has(qf.key)
          return (
            <button
              key={qf.key}
              onClick={() => onToggleQuickFilter(qf.key)}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-medium transition ${
                active
                  ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-15)] text-[var(--color-accent-text-muted)]'
                  : 'border-white/8 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              {qf.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
