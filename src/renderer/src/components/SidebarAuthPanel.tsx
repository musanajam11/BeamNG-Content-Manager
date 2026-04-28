// Bottom-of-sidebar global auth status panel.
//
// Surfaces sign-in state for the three accounts the desktop app uses:
//   • BeamNG.com (cookie session, opened in Electron browser window)
//   • BeamMP (launcher account or guest)
//   • BMR  (BeamNG Mod Registry @ bmr.musanet.xyz)
//
// Each row shows a coloured status dot (green = signed in, red = signed out)
// plus a quick action button. When the sidebar is collapsed we render
// just the three icons + dots in a vertical strip.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LogIn, LogOut, Loader2, Database, Gamepad2, Users } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { useBmrAuth } from './bmr/BmrComponents'
import { LoginSheet } from './servers/LoginSheet'

type ProviderKey = 'beamng' | 'beammp' | 'bmr'

interface ProviderStatus {
  key: ProviderKey
  signedIn: boolean
  username: string | null
  loading: boolean
}

export function SidebarAuthPanel(): React.JSX.Element {
  const { sidebarCollapsed } = useAppStore()
  const { t } = useTranslation()
  const bmr = useBmrAuth()

  const [beamng, setBeamng] = useState<ProviderStatus>({
    key: 'beamng', signedIn: false, username: null, loading: true,
  })
  const [beammp, setBeammp] = useState<ProviderStatus>({
    key: 'beammp', signedIn: false, username: null, loading: true,
  })
  const [showBeamMpLogin, setShowBeamMpLogin] = useState(false)
  const [busy, setBusy] = useState<ProviderKey | null>(null)

  const refreshBeamng = useCallback(async () => {
    try {
      const r = await window.api.beamngWebLoggedIn()
      setBeamng({ key: 'beamng', signedIn: r.loggedIn, username: r.username || null, loading: false })
    } catch {
      setBeamng({ key: 'beamng', signedIn: false, username: null, loading: false })
    }
  }, [])

  const refreshBeammp = useCallback(async () => {
    try {
      const info = await window.api.getAuthInfo()
      setBeammp({
        key: 'beammp',
        signedIn: info.authenticated && !info.guest,
        username: info.username || (info.guest ? 'guest' : null),
        loading: false,
      })
    } catch {
      setBeammp({ key: 'beammp', signedIn: false, username: null, loading: false })
    }
  }, [])

  useEffect(() => { void refreshBeamng(); void refreshBeammp() }, [refreshBeamng, refreshBeammp])
  // Light periodic refresh — auth state for these providers can change
  // outside the renderer (e.g. via the game launcher) so 30 s polling is
  // a reasonable compromise between freshness and noise.
  useEffect(() => {
    const id = setInterval(() => { void refreshBeamng(); void refreshBeammp() }, 30000)
    return () => clearInterval(id)
  }, [refreshBeamng, refreshBeammp])

  const handleBeamngClick = useCallback(async () => {
    setBusy('beamng')
    try {
      if (beamng.signedIn) {
        await window.api.beamngWebLogout()
      } else {
        await window.api.beamngWebLogin()
      }
      await refreshBeamng()
    } finally {
      setBusy(null)
    }
  }, [beamng.signedIn, refreshBeamng])

  const handleBeammpClick = useCallback(async () => {
    if (beammp.signedIn) {
      setBusy('beammp')
      try {
        await window.api.beammpLogout()
        await refreshBeammp()
      } finally {
        setBusy(null)
      }
    } else {
      setShowBeamMpLogin(true)
    }
  }, [beammp.signedIn, refreshBeammp])

  const handleBmrClick = useCallback(async () => {
    setBusy('bmr')
    try {
      if (bmr.signedIn) {
        await bmr.signOut()
      } else {
        await window.api.bmrDesktopSignIn()
        await bmr.refresh()
      }
    } finally {
      setBusy(null)
    }
  }, [bmr])

  const rows: Array<{
    status: ProviderStatus
    label: string
    Icon: typeof Database
    onClick: () => void
  }> = [
    {
      status: beamng,
      label: t('auth.beamng'),
      Icon: Gamepad2,
      onClick: () => void handleBeamngClick(),
    },
    {
      status: beammp,
      label: t('auth.beammp'),
      Icon: Users,
      onClick: () => void handleBeammpClick(),
    },
    {
      status: { key: 'bmr', signedIn: bmr.signedIn, username: bmr.user?.display_name ?? null, loading: bmr.loading },
      label: t('auth.bmr'),
      Icon: Database,
      onClick: () => void handleBmrClick(),
    },
  ]

  // Collapsed view — single column of icon buttons with a status dot.
  if (sidebarCollapsed) {
    return (
      <div className="flex flex-col gap-1 px-1.5 pt-2 border-t border-[var(--color-border)]">
        {rows.map(({ status, label, Icon, onClick }) => {
          const isBusy = busy === status.key || status.loading
          return (
            <button
              key={status.key}
              onClick={onClick}
              disabled={isBusy}
              title={`${label} — ${status.signedIn ? (status.username ?? t('auth.signedIn')) : t('auth.signedOut')}`}
              className="relative flex items-center justify-center py-2 rounded-xl text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
              aria-label={label}
            >
              {isBusy ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
              <span
                aria-hidden
                className={`absolute top-1 right-1 w-2 h-2 rounded-full ring-1 ring-[var(--color-surface)] ${
                  status.signedIn ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              />
            </button>
          )
        })}
      </div>
    )
  }

  // Expanded view — provider name + username (when signed in) + action.
  return (
    <div className="flex flex-col gap-1 px-2 pt-2 border-t border-[var(--color-border)]">
      <p className="px-1 pt-0.5 pb-1 text-[9px] uppercase tracking-widest text-[var(--color-text-muted)]">
        {t('auth.accounts')}
      </p>
      {rows.map(({ status, label, Icon, onClick }) => {
        const isBusy = busy === status.key || status.loading
        return (
          <button
            key={status.key}
            onClick={onClick}
            disabled={isBusy}
            className="group flex items-center gap-2 px-2 py-1.5 rounded-xl text-left text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            title={status.signedIn ? t('auth.clickSignOut') : t('auth.clickSignIn')}
          >
            <span className="relative shrink-0">
              <Icon size={14} />
              <span
                aria-hidden
                className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ring-1 ring-[var(--color-surface)] ${
                  status.signedIn ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[11px] font-medium leading-tight truncate">{label}</span>
              <span className="block text-[10px] text-[var(--color-text-muted)] leading-tight truncate">
                {status.signedIn ? (status.username ?? t('auth.signedIn')) : t('auth.signedOut')}
              </span>
            </span>
            {isBusy ? (
              <Loader2 size={12} className="animate-spin shrink-0 text-[var(--color-text-muted)]" />
            ) : status.signedIn ? (
              <LogOut size={12} className="shrink-0 opacity-60 group-hover:opacity-100" />
            ) : (
              <LogIn size={12} className="shrink-0 opacity-60 group-hover:opacity-100" />
            )}
          </button>
        )
      })}

      {showBeamMpLogin && createPortal(
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60"
          onClick={() => setShowBeamMpLogin(false)}
        >
          <div
            className="w-[min(560px,92vw)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-base)] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {t('auth.beammpSignIn')}
              </h3>
              <button
                onClick={() => setShowBeamMpLogin(false)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-lg leading-none px-1"
              >
                ×
              </button>
            </div>
            <LoginSheet
              onClose={() => setShowBeamMpLogin(false)}
              onSuccess={() => void refreshBeammp()}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
