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
  wip?: boolean
  hintDesc?: string
}

export const ALL_NAV_ITEMS: NavItem[] = [
  { id: 'home', labelKey: 'sidebar.home', icon: Home, hintDesc: 'Quick access overview and recent activity' },
  { id: 'servers', labelKey: 'sidebar.servers', icon: Server, hintDesc: 'Browse and join BeamMP multiplayer servers' },
  { id: 'friends', labelKey: 'sidebar.friends', icon: Users, wip: true, hintDesc: 'View friends, see what they\'re playing, and join them' },
  { id: 'vehicles', labelKey: 'sidebar.vehicles', icon: Car, hintDesc: 'Manage your vehicle mods and configs' },
  { id: 'maps', labelKey: 'sidebar.maps', icon: MapIcon, hintDesc: 'Browse, install, and preview track mods' },
  { id: 'mods', labelKey: 'sidebar.mods', icon: Package, hintDesc: 'Install, remove, and toggle all your mods' },
  { id: 'career', labelKey: 'sidebar.career', icon: Briefcase, hintDesc: 'Manage career mode save files' },
  { id: 'server-admin', labelKey: 'sidebar.serverManager', icon: MonitorCog, hintDesc: 'Host and manage your own BeamMP server' },
  { id: 'launcher', labelKey: 'sidebar.launcher', icon: Terminal, hintDesc: 'Configure launcher settings and launch options' },
  { id: 'controls', labelKey: 'sidebar.controls', icon: Gamepad2, wip: true, hintDesc: 'Map controller and keyboard bindings' },
  { id: 'live-gps', labelKey: 'sidebar.liveGPS', icon: Navigation2, hintDesc: 'Real-time GPS map overlay while in-game' },
  { id: 'livery-editor', labelKey: 'sidebar.liveryEditor', icon: Paintbrush, wip: true, hintDesc: 'Design and apply custom vehicle liveries' },
  { id: 'voice-chat', labelKey: 'sidebar.voiceChat', icon: Mic, wip: true, hintDesc: 'Configure in-game proximity voice chat' },
  { id: 'lua-console', labelKey: 'sidebar.luaConsole', icon: Code2, hintDesc: 'Run Lua scripts and inspect game state' },
  { id: 'world-edit-sync', labelKey: 'sidebar.worldEditSync', icon: Globe2, wip: true, hintDesc: 'Sync world editor changes with other players in real time' },
]
