import {
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/useAppStore'
import { useThemeStore } from '../stores/useThemeStore'
import { ALL_NAV_ITEMS } from './navItems'
import type { NavItem } from './navItems'
import type { AppPage } from '../../../shared/types'

const itemMap = new Map(ALL_NAV_ITEMS.map((item) => [item.id, item]))

const bottomItems: NavItem[] = [
  { id: 'settings', labelKey: 'sidebar.settings', icon: Settings, hintDesc: 'Customize the UI and turn off hints here' }
]

export function Sidebar(): React.JSX.Element {
  const { currentPage, setPage, sidebarCollapsed, toggleSidebar } = useAppStore()
  const { appearance } = useThemeStore()
  const { t } = useTranslation()

  // Track which pages have been visited this session so their hint icons disappear after first click
  const [visitedPages, setVisitedPages] = useState<Set<AppPage>>(() => new Set([currentPage]))

  const handleSetPage = useCallback((id: AppPage) => {
    setVisitedPages((prev) => { const next = new Set(prev); next.add(id); return next })
    setPage(id)
  }, [setPage])

  const visibleItems = useMemo(() => {
    const hidden = new Set(appearance.sidebarHidden ?? [])
    const order = appearance.sidebarOrder ?? []
    const ordered: NavItem[] = []
    const seen = new Set<AppPage>()

    // Add items in the configured order
    for (const id of order) {
      if (hidden.has(id)) continue
      const item = itemMap.get(id)
      if (item) {
        ordered.push(item)
        seen.add(id)
      }
    }

    // Append any new items not in the saved order (future-proofing)
    for (const item of ALL_NAV_ITEMS) {
      if (!seen.has(item.id) && !hidden.has(item.id)) {
        ordered.push(item)
      }
    }

    return ordered
  }, [appearance.sidebarOrder, appearance.sidebarHidden])

  const renderItem = ({ id, labelKey, icon: Icon, wip, hintDesc }: NavItem): React.JSX.Element => {
    const active = currentPage === id
    const label = t(labelKey)
    const showHints = appearance.showHints ?? true
    // Sleek ping-dot only on Settings to guide users there; disappears once visited
    const showSettingsPing = showHints && id === 'settings' && !visitedPages.has('settings')

    const titleText = sidebarCollapsed
      ? showHints && hintDesc
        ? `${label} — ${hintDesc}`
        : wip
          ? `${label} (WIP)`
          : label
      : wip
        ? 'Work in progress'
        : undefined

    return (
      <button
        key={id}
        onClick={() => handleSetPage(id)}
        className={`group relative flex items-center gap-3 w-full rounded-xl transition-all duration-150 overflow-visible ${
          sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'
        } ${
          active
            ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)] border border-[var(--color-accent-25)]'
            : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] border border-transparent'
        }`}
        title={titleText}
      >
        <span className="relative shrink-0">
          <Icon size={sidebarCollapsed ? 18 : 16} className="shrink-0" />
          {wip && sidebarCollapsed && (
            <span
              className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-amber-400 ring-1 ring-[var(--color-surface)]"
              aria-hidden="true"
            />
          )}
          {/* Subtle ping dot on Settings icon — guides user to turn off hints */}
          {showSettingsPing && (
            <span className="absolute -top-1 -right-1" aria-hidden="true">
              <span className="block w-2 h-2 rounded-full bg-[var(--color-accent)] animate-ping opacity-75" />
              <span className="absolute inset-0 block w-2 h-2 rounded-full bg-[var(--color-accent)]" />
            </span>
          )}
        </span>
        {!sidebarCollapsed && (
          <>
            <span className="text-[13px] font-medium truncate">{label}</span>
            {wip && (
              <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-amber-400/15 text-amber-500 border border-amber-400/30 leading-none">
                WIP
              </span>
            )}
          </>
        )}

        {/* Hover tooltip — accent background, fully readable */}
        {showHints && hintDesc && !sidebarCollapsed && (
          <div
            className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 z-50 w-56 rounded-lg px-3 py-2.5 text-xs shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            style={{ background: 'var(--color-accent)', color: '#fff' }}
          >
            <span className="font-semibold opacity-80">💡 </span>
            <span className="font-semibold">{label}</span>
            <p className="mt-1 leading-snug opacity-90">{hintDesc}</p>
          </div>
        )}
      </button>
    )
  }

  return (
    <aside
      className="flex flex-col border-r-2 border-[var(--color-border)] transition-all duration-200 bg-[var(--color-scrim-20)] backdrop-blur-sm"
      style={{ width: sidebarCollapsed ? '52px' : 'var(--sidebar-width)' }}
    >
      <nav className="flex-1 flex flex-col gap-1 p-3 pt-3 overflow-visible">
        {visibleItems.map(renderItem)}
      </nav>

      <div className="flex flex-col gap-1 p-3 border-t border-[var(--color-border)] overflow-visible">
        {bottomItems.map(renderItem)}
        <button
          onClick={toggleSidebar}
          className={`flex items-center gap-3 w-full rounded-xl text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] transition-all duration-150 ${
            sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'
          }`}
          aria-label={sidebarCollapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')}
        >
          {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          {!sidebarCollapsed && <span className="text-[12px] font-medium">{t('sidebar.collapse')}</span>}
        </button>
      </div>
    </aside>
  )
}
