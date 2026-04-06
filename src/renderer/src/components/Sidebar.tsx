import {
  Home,
  Server,
  Car,
  Map,
  Package,
  Settings,
  ChevronLeft,
  ChevronRight,
  Terminal,
  MonitorCog,
  Users
} from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import type { AppPage } from '../../../shared/types'

interface NavItem {
  id: AppPage
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

const navItems: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'servers', label: 'Servers', icon: Server },
  { id: 'friends', label: 'Friends', icon: Users },
  { id: 'vehicles', label: 'Vehicles', icon: Car },
  { id: 'maps', label: 'Maps', icon: Map },
  { id: 'mods', label: 'Mods', icon: Package },
  { id: 'server-admin', label: 'Server Manager', icon: MonitorCog },
  { id: 'launcher', label: 'BeamMP Launcher', icon: Terminal },
]

const bottomItems: NavItem[] = [
  { id: 'settings', label: 'Settings', icon: Settings }
]

export function Sidebar(): React.JSX.Element {
  const { currentPage, setPage, sidebarCollapsed, toggleSidebar } = useAppStore()

  const renderItem = ({ id, label, icon: Icon }: NavItem): React.JSX.Element => {
    const active = currentPage === id
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
        {navItems.map(renderItem)}
      </nav>

      <div className="flex flex-col gap-1 p-3 border-t border-[var(--color-border)]">
        {bottomItems.map(renderItem)}
        <button
          onClick={toggleSidebar}
          className={`flex items-center gap-3 w-full rounded-xl text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all duration-150 ${
            sidebarCollapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2'
          }`}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          {!sidebarCollapsed && <span className="text-[12px] font-medium">Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
