import { ChevronUp, ChevronDown, ArrowUpDown, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SortField, SortDir, FilterTab, QuickFilter } from '../../stores/useServerStore'

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

const QF_KEYS: QuickFilter[] = ['hideEmpty', 'hideFull', 'officialOnly', 'moddedOnly', 'noPassword']
const QF_I18N: Record<QuickFilter, string> = {
  hideEmpty: 'servers.hideEmpty',
  hideFull: 'servers.hideFull',
  officialOnly: 'servers.officialOnly',
  moddedOnly: 'servers.moddedOnly',
  noPassword: 'servers.noPassword'
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
                ? 'bg-white text-slate-950 shadow-sm'
                : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            {t(TAB_I18N[key])}
          </button>
        ))}

        <div className="mx-1 h-4 w-px bg-white/10" />

        {SORT_KEYS.map((key) => {
          const active = sortField === key
          return (
            <button
              key={key}
              onClick={() => onSort(key)}
              className={`inline-flex items-center gap-0.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                active
                  ? 'bg-[var(--color-accent-15)] text-white'
                  : 'text-slate-400 hover:bg-white/8 hover:text-slate-200'
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

      {/* Quick filters row */}
      <div className="flex items-center gap-1.5">
        <SlidersHorizontal size={11} className="text-slate-400" />
        <span className="text-[11px] text-slate-400 mr-0.5">{t('servers.quickFilters')}</span>
        {QF_KEYS.map((key) => {
          const active = quickFilters.has(key)
          return (
            <button
              key={key}
              onClick={() => onToggleQuickFilter(key)}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-medium transition ${
                active
                  ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-15)] text-[var(--color-accent-text-muted)]'
                  : 'border-white/8 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              {t(QF_I18N[key])}
            </button>
          )
        })}
      </div>
    </div>
  )
}
