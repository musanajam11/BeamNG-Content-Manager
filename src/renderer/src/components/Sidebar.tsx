import {
  Home,
  Server,
  Car,
  Map as MapIcon,
  Package,
  Settings,
  ChevronLeft,
  ChevronRight,
  Terminal,
  MonitorCog,
  Users,
  Gamepad2,
  Briefcase,
  Navigation2
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/useAppStore'
import { useThemeStore } from '../stores/useThemeStore'
import type { AppPage } from '../../../shared/types'

export interface NavItem {
  id: AppPage
  labelKey: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

export const ALL_NAV_ITEMS: NavItem[] = [
  { id: 'home', labelKey: 'sidebar.home', icon: Home },
  { id: 'servers', labelKey: 'sidebar.servers', icon: Server },
  { id: 'friends', labelKey: 'sidebar.friends', icon: Users },
  { id: 'vehicles', labelKey: 'sidebar.vehicles', icon: Car },
  { id: 'maps', labelKey: 'sidebar.maps', icon: MapIcon },
  { id: 'mods', labelKey: 'sidebar.mods', icon: Package },
  { id: 'career', labelKey: 'sidebar.career', icon: Briefcase },
  { id: 'server-admin', labelKey: 'sidebar.serverManager', icon: MonitorCog },
  { id: 'launcher', labelKey: 'sidebar.launcher', icon: Terminal },
  { id: 'controls', labelKey: 'sidebar.controls', icon: Gamepad2 },
  { id: 'live-gps', labelKey: 'sidebar.liveGPS', icon: Navigation2 },
]

const itemMap = new Map(ALL_NAV_ITEMS.map((item) => [item.id, item]))

const bottomItems: NavItem[] = [
  { id: 'settings', labelKey: 'sidebar.settings', icon: Settings }
]

export function Sidebar(): React.JSX.Element {
  const { currentPage, setPage, sidebarCollapsed, toggleSidebar } = useAppStore()
  const { appearance } = useThemeStore()
  const { t } = useTranslation()

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

  const renderItem = ({ id, labelKey, icon: Icon }: NavItem): React.JSX.Element => {
    const active = currentPage === id
    const label = t(labelKey)
    return (
      <button
        key={id}
        onClick={() => setPage(id)}
        className={`group relative flex items-center gap-3 w-full rounded-xl transition-all duration-150 ${
          sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'
        } ${
          active
            ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)] border border-[var(--color-accent-25)]'
            : 'text-slate-400 hover:text-white hover:bg-white/8 border border-transparent'
        }`}
        title={sidebarCollapsed ? label : undefined}
      >
        <Icon size={sidebarCollapsed ? 18 : 16} className="shrink-0" />
        {!sidebarCollapsed && (
          <span className="text-[13px] font-medium truncate">{label}</span>
        )}
      </button>
    )
  }

  return (
    <aside
      className="flex flex-col border-r-2 border-[var(--color-border)] transition-all duration-200 bg-black/20 backdrop-blur-sm"
      style={{ width: sidebarCollapsed ? '52px' : 'var(--sidebar-width)' }}
    >
      <nav className="flex-1 flex flex-col gap-1 p-3 pt-3">
        {visibleItems.map(renderItem)}
      </nav>

      <div className="flex flex-col gap-1 p-3 border-t border-[var(--color-border)]">
        {bottomItems.map(renderItem)}
        <button
          onClick={toggleSidebar}
          className={`flex items-center gap-3 w-full rounded-xl text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all duration-150 ${
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
