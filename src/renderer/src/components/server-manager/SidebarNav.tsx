import { useState } from 'react'
import {
  Activity,
  Terminal,
  Calendar,
  Settings,
  FolderOpen,
  BarChart3,
  Archive,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Map
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BeamMPText } from '../BeamMPText'

type Tab = 'status' | 'config' | 'console' | 'files' | 'mods' | 'heatmap' | 'schedule' | 'analytics'

interface NavItem {
  id: Tab | string
  i18nKey: string
  icon: React.ReactNode
  disabled?: boolean
  badgeKey?: string
}

const navItems: NavItem[] = [
  { id: 'status', i18nKey: 'serverManager.sidebarStatus', icon: <Activity size={18} /> },
  { id: 'console', i18nKey: 'serverManager.sidebarConsole', icon: <Terminal size={18} /> },
  { id: 'config', i18nKey: 'serverManager.sidebarConfiguration', icon: <Settings size={18} /> },
  { id: 'files', i18nKey: 'serverManager.sidebarFileManager', icon: <FolderOpen size={18} /> },
  { id: 'mods', i18nKey: 'serverManager.sidebarMods', icon: <Archive size={18} /> },
  { id: 'schedule', i18nKey: 'serverManager.sidebarSchedule', icon: <Calendar size={18} /> },
  { id: 'analytics', i18nKey: 'serverManager.sidebarAnalytics', icon: <BarChart3 size={18} /> },
  { id: 'heatmap', i18nKey: 'serverManager.sidebarPlayerHeatMap', icon: <Map size={18} /> },
  { id: 'help', i18nKey: 'serverManager.sidebarSupport', icon: <HelpCircle size={18} />, disabled: true, badgeKey: 'serverManager.sidebarSoon' }
]

interface SidebarNavProps {
  activeTab: string
  serverName: string
  serverState: string
  onTabChange: (tab: Tab) => void
}

const stateColors: Record<string, string> = {
  running: 'bg-green-500',
  starting: 'bg-yellow-500',
  stopped: 'bg-zinc-500',
  error: 'bg-red-500'
}

export function SidebarNav({ activeTab, serverName, serverState, onTabChange }: SidebarNavProps): React.JSX.Element {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className={`${collapsed ? 'w-14' : 'w-52'} shrink-0 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-bg)] transition-all duration-200`}>
      {/* Server identity */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${stateColors[serverState] ?? 'bg-zinc-500'}`} />
        {!collapsed && (
          <div className="min-w-0 flex-1 overflow-hidden">
            <BeamMPText text={serverName} className="block text-sm font-semibold text-[var(--color-text-primary)] truncate" />
            <span className="text-xs text-[var(--color-text-muted)] capitalize">{serverState}</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors shrink-0"
          title={collapsed ? t('serverManager.expandSidebar') : t('serverManager.collapseSidebar')}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-2 flex flex-col gap-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = activeTab === item.id
          const isDisabled = item.disabled
          return (
            <button
              key={item.id}
              disabled={isDisabled}
              onClick={() => !isDisabled && onTabChange(item.id as Tab)}
              title={collapsed ? t(item.i18nKey) : undefined}
              className={`
                mx-2 flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-md text-sm font-medium transition-colors
                ${isActive
                  ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                  : isDisabled
                    ? 'text-[var(--color-text-muted)]/40 cursor-not-allowed'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                }
              `}
            >
              <span className={`shrink-0 ${isActive ? 'text-[var(--color-accent)]' : ''}`}>{item.icon}</span>
              {!collapsed && t(item.i18nKey)}
              {!collapsed && isDisabled && item.badgeKey && (
                <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
                  item.badgeKey === 'Next'
                    ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                    : 'bg-[var(--color-surface-hover)] text-[var(--color-text-muted)]'
                }`}>{t(item.badgeKey)}</span>
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
