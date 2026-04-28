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
import { LuaConsolePage } from './pages/LuaConsolePage'
import { WorldEditSyncPage } from './pages/WorldEditSyncPage'
import { SetupWizard } from './pages/SetupWizard'
import { VoiceChatPanel } from './components/VoiceChatPanel'
import { useAppStore } from './stores/useAppStore'
import { useServerStore } from './stores/useServerStore'
import { useVoiceChatStore } from './stores/useVoiceChatStore'
import { useGameStore } from './stores/useGameStore'
import { useWorldEditSessionStore } from './stores/useWorldEditSessionStore'
import { useThemeStore, resolveColorMode, applyTheme } from './stores/useThemeStore'
import { useHostedServerStore } from './stores/useHostedServerStore'
import { BmrAuthProvider } from './components/bmr/BmrComponents'
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
    case 'lua-console':
      return <LuaConsolePage />
    case 'world-edit-sync':
      return <WorldEditSyncPage />
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

  // World Editor Sync — register IPC subscriptions once at the App level so
  // op/log/peer history survives navigating away from the session page. The
  // page itself just reads from the store.
  useEffect(() => {
    const store = useWorldEditSessionStore
    const off1 = window.api.onWorldEditSessionOp?.((op) => store.getState().pushOp(op))
    const off2 = window.api.onWorldEditSessionLog?.((entry) => store.getState().pushLog(entry))
    const off3 = window.api.onWorldEditSessionPeerPose?.((pose) => store.getState().setPose(pose))
    const off4 = window.api.onWorldEditSessionPeerActivity?.((act) => store.getState().setActivity(act))
    return () => {
      off1?.()
      off2?.()
      off3?.()
      off4?.()
    }
  }, [])

  // Discord Rich Presence: update when the user joins / leaves a server
  useEffect(() => {
    // Seed the renderer game-status store immediately so any UI mounted
    // before the first onGameStatusChange fires (e.g. VoiceChatPage on app
    // start while the game is already running) sees the right value.
    useGameStore.getState().refreshStatus().catch(() => { /* best-effort */ })

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
        // Window is hidden / minimized → Discord-presence freshness doesn't
        // matter here, skip the IPC roundtrip entirely.
        if (typeof document !== 'undefined' && document.hidden) return
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
      // Mirror main-process game status into the renderer store so any UI
      // (e.g. VoiceChatPage toggle gate) reacts immediately.
      useGameStore.getState().setGameStatus(status)
      // If the game stops (or BeamNG was killed), proactively turn voice off
      // so we don't sit on stale renderer-side WebRTC state until next launch.
      if (!status.running && useVoiceChatStore.getState().enabled) {
        console.log('[VoiceChat][App] game stopped — auto-disabling voice')
        useVoiceChatStore.getState().disable()
      }
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
          // Not found in the public server list — check if it's one of the
          // user's own hosted servers (matched by port, since it'll be 127.0.0.1)
          const connPort = parseInt(status.connectedServer.split(':')[1] ?? '', 10)
          const hostedEntries = useHostedServerStore.getState().servers
          const hostedMatch = connPort
            ? hostedEntries.find((e) => e.config.port === connPort)
            : undefined
          if (hostedMatch) {
            window.api.discordSetPlaying({
              serverName: hostedMatch.config.name,
              mapName: hostedMatch.config.map
                ? hostedMatch.config.map.replace(/^\/levels\//, '').replace(/\/info\.json$/, '').replace(/\//g, ' ').trim()
                : '',
            })
          } else {
            window.api.discordSetPlaying({
              serverName: 'a private server',
              mapName: ''
            })
          }
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

  // Voice chat bootstrap — ALWAYS active at app level so signals are never dropped
  // and so we can auto-enable when the user joins a server. Without this, the
  // renderer's WebRTC stack would only initialise when the user manually toggles
  // voice in the Voice Chat settings page, leaving server-side enable orphaned.
  useEffect(() => {
    // Always-on subscriptions to incoming WebRTC signalling events from main.
    const unsubPeerJoined = window.api.onVoicePeerJoined((data) => {
      console.log('[VoiceChat][App] peerJoined', data)
      useVoiceChatStore.getState().handlePeerJoined(data.playerId, data.playerName, data.polite)
    })
    const unsubPeerLeft = window.api.onVoicePeerLeft((data) => {
      console.log('[VoiceChat][App] peerLeft', data)
      useVoiceChatStore.getState().handlePeerLeft(data.playerId)
    })
    const unsubSignal = window.api.onVoiceSignal((data) => {
      useVoiceChatStore.getState().handleSignal(data.fromId, data.payload)
    })
    const unsubSelfId = window.api.onVoiceSelfId(({ selfId }) => {
      console.log('[VoiceChat][App] selfId from server:', selfId)
      useVoiceChatStore.getState().setSelfId(selfId)
    })

    // Auto-enable / disable when joining or leaving a server
    const unsubRelay = window.api.onVoiceRelayState(({ inRelay }) => {
      const cfg = useAppStore.getState().config
      if (!cfg?.voiceChat?.enabled) {
        console.log('[VoiceChat][App] relayState change but voice disabled in settings — ignoring')
        return
      }
      const store = useVoiceChatStore.getState()
      if (inRelay && !store.enabled) {
        console.log('[VoiceChat][App] joined server — auto-enabling voice')
        store.enable().catch((err) => console.error('[VoiceChat][App] auto-enable failed', err))
      } else if (!inRelay && store.enabled) {
        console.log('[VoiceChat][App] left server — auto-disabling voice')
        store.disable()
      }
    })

    return () => {
      unsubPeerJoined()
      unsubPeerLeft()
      unsubSignal()
      unsubSelfId()
      unsubRelay()
    }
  }, [])

  // Apply appearance settings and language once config is loaded
  useEffect(() => {
    if (config?.appearance) {
      const appearance = config.appearance
      if (appearance.bgImageList.length === 0) {
        // Fresh install: populate bgImageList with bundled defaults first so
        // bgCycleOnLaunch can pick a random background on first launch
        window.api.getDefaultBackgrounds().then((paths) => {
          if (paths.length > 0) {
            const withDefaults = { ...appearance, bgImageList: paths }
            window.api.updateConfig({ appearance: withDefaults })
            loadTheme(withDefaults)
          } else {
            loadTheme(appearance)
          }
        })
      } else {
        loadTheme(appearance)
      }
    }
    if (config?.language) {
      i18n.changeLanguage(config.language)
    }
  }, [configLoaded])

  // Re-apply theme when OS color scheme changes (only matters when colorMode === 'system')
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      const appearance = useAppStore.getState().config?.appearance
      if (appearance?.colorMode === 'system') {
        const mode = resolveColorMode('system')
        applyTheme(appearance, mode)
      }
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

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
      <BmrAuthProvider>
        <div className="relative z-10 flex flex-col h-full">
          <Titlebar />
          <div className="flex flex-1 min-h-0">
            <Sidebar />
            <main className="flex-1 min-w-0 overflow-clip">
              <ErrorBoundary>
                <PageRouter />
              </ErrorBoundary>
            </main>
          </div>
          <StatusBar />
          <VoiceChatPanel />
        </div>
      </BmrAuthProvider>
    </div>
  )
}

export default App
