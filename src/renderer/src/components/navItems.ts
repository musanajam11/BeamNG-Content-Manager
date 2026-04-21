import {
  Home,
  Server,
  Car,
  Map as MapIcon,
  Package,
  Terminal,
  MonitorCog,
  Users,
  Gamepad2,
  Briefcase,
  Navigation2,
  Paintbrush,
  Mic,
  Code2,
  Globe2
} from 'lucide-react'
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
  { id: 'livery-editor', labelKey: 'sidebar.liveryEditor', icon: Paintbrush },
  { id: 'voice-chat', labelKey: 'sidebar.voiceChat', icon: Mic },
  { id: 'lua-console', labelKey: 'sidebar.luaConsole', icon: Code2 },
  { id: 'world-edit-sync', labelKey: 'sidebar.worldEditSync', icon: Globe2 },
]
