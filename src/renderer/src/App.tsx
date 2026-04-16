import { useEffect } from 'react'
import { Titlebar } from './components/Titlebar'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { HomePage } from './pages/HomePage'
import { ServersPage } from './pages/ServersPage'
import { FriendsPage } from './pages/FriendsPage'
import { VehiclesPage } from './pages/VehiclesPage'
import { MapsPage } from './pages/MapsPage'
import { ModsPage } from './pages/ModsPage'
import { SettingsPage } from './pages/SettingsPage'
import { LauncherPage } from './pages/LauncherPage'
import { ControlsPage } from './pages/ControlsPage'
import { ServerManagerPage } from './pages/ServerManagerPage'
import { CareerPage } from './pages/CareerPage'
import { LiveGPSPage } from './pages/LiveGPSPage'
import { LiveryEditorPage } from './pages/LiveryEditorPage'
import { VoiceChatPage } from './pages/VoiceChatPage'
import { SetupWizard } from './pages/SetupWizard'
import { VoiceChatPanel } from './components/VoiceChatPanel'
import { useAppStore } from './stores/useAppStore'
import { useServerStore } from './stores/useServerStore'
import { useThemeStore } from './stores/useThemeStore'
import i18n from './i18n'

function PageRouter(): React.JSX.Element {
  const currentPage = useAppStore((s) => s.currentPage)

  switch (currentPage) {
    case 'home':
      return <HomePage />
    case 'servers':
      return <ServersPage />
    case 'friends':
      return <FriendsPage />
    case 'vehicles':
      return <VehiclesPage />
    case 'maps':
      return <MapsPage />
    case 'mods':
      return <ModsPage />
    case 'launcher':
      return <LauncherPage />
    case 'controls':
      return <ControlsPage />
    case 'server-admin':
      return <ServerManagerPage />
    case 'career':
      return <CareerPage />
    case 'live-gps':
      return <LiveGPSPage />
    case 'livery-editor':
      return <LiveryEditorPage />
    case 'voice-chat':
      return <VoiceChatPage />
    case 'settings':
      return <SettingsPage />
    default:
      return <HomePage />
  }
}

function App(): React.JSX.Element {
  const { config, configLoaded, loadConfig } = useAppStore()
  const loadTheme = useThemeStore((s) => s.load)

  useEffect(() => {
    loadConfig()
  }, [])

  // Auto-updater listeners — registered once at app level so state persists across navigation
  useEffect(() => {
    const { setUpdateAvailable, setUpdateProgress, setUpdateReady } = useAppStore.getState()
    const unsub1 = window.api.onUpdateAvailable((info) => {
      setUpdateAvailable({ version: info.version })
    })
    const unsub2 = window.api.onUpdateDownloadProgress((progress) => {
      setUpdateProgress(progress.percent)
    })
    const unsub3 = window.api.onUpdateDownloaded((info) => {
      setUpdateReady(info.version)
    })
    return () => { unsub1(); unsub2(); unsub3() }
  }, [])

  // Discord Rich Presence: update when the user joins / leaves a server
  useEffect(() => {
    let vehiclePoller: ReturnType<typeof setInterval> | null = null
    let lastVehicleId = ''
    // Cache the vehicle list so we only fetch it once per session
    let vehicleListCache: Array<{ name: string; displayName: string; brand: string }> | null = null

    async function getVehicleDisplayName(vehicleId: string): Promise<string> {
      if (!vehicleListCache) {
        try {
          vehicleListCache = await window.api.listVehicles()
        } catch {
          vehicleListCache = []
        }
      }
      const match = vehicleListCache!.find(
        (v) => v.name.toLowerCase() === vehicleId.toLowerCase()
      )
      return match ? `${match.brand} ${match.displayName}`.trim() : vehicleId.replace(/_/g, ' ')
    }

    function startVehiclePoller(serverIdent: string): void {
      if (vehiclePoller) return
      vehiclePoller = setInterval(async () => {
        try {
          const telemetry = await window.api.gpsGetTelemetry()
          if (!telemetry?.vehicleId || telemetry.vehicleId === lastVehicleId) return
          lastVehicleId = telemetry.vehicleId

          const servers = useServerStore.getState().servers
          const server = servers.find((s) => `${s.ip}:${s.port}` === serverIdent)
          if (!server) return

          const carName = await getVehicleDisplayName(telemetry.vehicleId)
          window.api.discordSetPlaying({
            serverName: server.sname.replace(/\^[0-9a-fA-F]/g, ''),
            mapName: server.map,
            carName,
            tags: server.tags || '',
            playerCount: parseInt(server.players, 10) || undefined,
            maxPlayers: parseInt(server.maxplayers, 10) || undefined
          })
        } catch { /* telemetry not available yet */ }
      }, 3000)
    }

    function stopVehiclePoller(): void {
      if (vehiclePoller) { clearInterval(vehiclePoller); vehiclePoller = null }
      lastVehicleId = ''
    }

    const unsub = window.api.onGameStatusChange((status) => {
      if (status.connectedServer) {
        const servers = useServerStore.getState().servers
        const server = servers.find(
          (s) => `${s.ip}:${s.port}` === status.connectedServer
        )
        if (server) {
          window.api.discordSetPlaying({
            serverName: server.sname.replace(/\^[0-9a-fA-F]/g, ''),
            mapName: server.map,
            tags: server.tags || '',
            playerCount: parseInt(server.players, 10) || undefined,
            maxPlayers: parseInt(server.maxplayers, 10) || undefined
          })
        } else {
          window.api.discordSetPlaying({
            serverName: status.connectedServer,
            mapName: 'Unknown'
          })
        }
        // Start polling telemetry for vehicle info
        startVehiclePoller(status.connectedServer)
      } else {
        stopVehiclePoller()
        window.api.discordClearPlaying()
      }
    })
    return () => { unsub(); stopVehiclePoller() }
  }, [])

  // Apply appearance settings and language once config is loaded
  useEffect(() => {
    if (config?.appearance) {
      loadTheme(config.appearance)
    }
    if (config?.language) {
      i18n.changeLanguage(config.language)
    }
  }, [configLoaded])

  if (!configLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--base)] text-[var(--text-muted)]">
        Loading...
      </div>
    )
  }

  if (config && !config.setupComplete) {
    return <SetupWizard />
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--color-base)] relative overflow-clip" style={{ backgroundImage: 'var(--app-bg-image)' }}>
      {/* Custom background image layer (only visible when --app-bg-image-url is set) */}
      <div
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat pointer-events-none"
        style={{
          backgroundImage: 'var(--app-bg-image-url, none)',
          opacity: 'var(--app-bg-opacity, 0)',
          filter: 'blur(var(--app-bg-blur, 0px))',
          transform: 'scale(1.05)'
        }}
      />
      {/* Dark overlay — only render when a bg image is active, to keep content readable */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          backgroundColor: 'var(--color-base)',
          opacity: 'var(--app-bg-overlay-opacity, 0)'
        }}
      />
      <div className="relative z-10 flex flex-col h-full">
        <Titlebar />
        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <main className="flex-1 min-w-0 overflow-clip p-6 pl-8">
            <ErrorBoundary>
              <PageRouter />
            </ErrorBoundary>
          </main>
        </div>
        <StatusBar />
        <VoiceChatPanel />
      </div>
    </div>
  )
}

export default App
