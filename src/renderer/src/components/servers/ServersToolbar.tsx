import { useState, useEffect } from 'react'
import { Search, RefreshCw, User, LogIn, LogOut, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LoginSheet } from './LoginSheet'
import { DirectConnectDialog } from './DirectConnectDialog'

interface Props {
  serverCount: number
  searchQuery: string
  loading: boolean
  joining: boolean
  highlightSignIn?: boolean
  onSearch: (query: string) => void
  onRefresh: () => void
  onDirectConnect: (ip: string, port: string) => void
}

export function ServersToolbar({
  searchQuery,
  loading,
  joining,
  highlightSignIn,
  onSearch,
  onRefresh,
  onDirectConnect
}: Props): React.JSX.Element {
  const [authInfo, setAuthInfo] = useState<{ authenticated: boolean; username: string; guest: boolean }>({
    authenticated: false,
    username: '',
    guest: false
  })
  const [showLogin, setShowLogin] = useState(false)
  const [showDirect, setShowDirect] = useState(false)

  useEffect(() => {
    refreshAuth()
  }, [])

  // Auto-open login sheet when sign-in is highlighted
  useEffect(() => {
    if (highlightSignIn && !authInfo.authenticated) {
      setShowLogin(true)
    }
  }, [highlightSignIn, authInfo.authenticated])

  const refreshAuth = async (): Promise<void> => {
    const info = await window.api.getAuthInfo()
    setAuthInfo(info)
  }

  const handleLogout = async (): Promise<void> => {
    await window.api.beammpLogout()
    await refreshAuth()
  }

  const { t } = useTranslation()

  return (
    <>
      {/* Header row: title + search + auth */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="rounded-lg border border-[var(--color-accent-20)] bg-[var(--color-accent-10)] p-2 text-[var(--color-accent-text-muted)]">
            <Server size={18} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white leading-tight">{t('servers.serverBrowser')}</h1>
            <p className="text-[11px] text-slate-400">{t('servers.serverBrowserSubtitle')}</p>
          </div>
        </div>

        {/* Search — takes remaining space */}
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-400" style={{ left: 14 }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('servers.searchPlaceholder')}
            className="w-full rounded-lg border border-white/8 bg-white/5 py-2 pr-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[var(--color-accent-40)] focus:bg-white/7"
            style={{ paddingLeft: 42 }}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowDirect(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-white accent-shadow-sm transition hover:opacity-95"
          >
            {t('servers.directConnect')}
          </button>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {t('servers.refresh')}
          </button>

          {/* Auth */}
          {authInfo.authenticated ? (
            <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/5 px-3 py-2">
              <div className="rounded-full bg-[var(--color-accent-15)] p-1 text-[var(--color-accent-text)]">
                <User size={12} />
              </div>
              <span className="text-xs font-medium text-white">{authInfo.username}{authInfo.guest ? ` ${t('servers.guest')}` : ''}</span>
              <button
                onClick={handleLogout}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/8"
                title={t('servers.logout')}
              >
                <LogOut size={12} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowLogin(!showLogin)}
              className={`inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-white accent-shadow-sm transition hover:opacity-95 ${
                highlightSignIn ? 'animate-pulse ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[#0f0f1a]' : ''
              }`}
            >
              <LogIn size={13} />
              {t('servers.signIn')}
            </button>
          )}
        </div>
      </div>

      {/* Login sheet */}
      {showLogin && !authInfo.authenticated && (
        <div className="mt-3">
          <LoginSheet onClose={() => setShowLogin(false)} onSuccess={refreshAuth} />
        </div>
      )}

      {/* Direct connect dialog */}
      <DirectConnectDialog
        open={showDirect}
        joining={joining}
        onClose={() => setShowDirect(false)}
        onConnect={(ip, port) => onDirectConnect(ip, port)}
      />
    </>
  )
}
