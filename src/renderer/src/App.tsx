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
import { SetupWizard } from './pages/SetupWizard'
import { useAppStore } from './stores/useAppStore'
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
      </div>
    </div>
  )
}

export default App
