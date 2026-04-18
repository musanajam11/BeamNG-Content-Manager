import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/useAppStore'

interface VersionInfo {
  appVersion: string
  gameVersion: string | null
  launcherVersion: string
  serverVersion: string | null
}

const REFRESH_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

export function StatusBar(): React.JSX.Element {
  const [versions, setVersions] = useState<VersionInfo | null>(null)
  const { t } = useTranslation()
  const currentPage = useAppStore((s) => s.currentPage)

  useEffect(() => {
    let cancelled = false
    let lastFetch = 0

    const refresh = (): void => {
      const now = Date.now()
      // Throttle: skip if last successful fetch was <30s ago (prevents spam from rapid nav)
      if (now - lastFetch < 30_000) return
      lastFetch = now
      window.api.getVersions().then((v) => { if (!cancelled) setVersions(v) }).catch(() => {})
    }

    refresh()
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Refresh whenever the user navigates to the Home page
  useEffect(() => {
    if (currentPage !== 'home') return
    window.api.getVersions().then(setVersions).catch(() => {})
  }, [currentPage])

  return (
    <div className="flex items-center justify-between h-[22px] shrink-0 border-t border-[var(--color-border)] bg-[var(--color-scrim-30)] text-[10px] text-[var(--color-text-muted)] select-none" style={{ paddingLeft: '12px', paddingRight: '12px' }}>
      <div className="flex items-center gap-3">
        {versions?.gameVersion && (
          <span>{t('statusBar.beamng', { version: versions.gameVersion })}</span>
        )}
        <span>{t('statusBar.beammpClient', { version: versions?.launcherVersion ?? '—' })} {t('statusBar.server', { version: versions?.serverVersion ?? '—' })}</span>
      </div>

      <span className="text-[var(--color-text-muted)]">
        {t('statusBar.madeWith')}
      </span>

      <div className="flex items-center gap-3">
        <span>BeamNG CM <span className="text-[var(--color-accent)]">{versions?.appVersion ?? '—'}</span></span>
      </div>
    </div>
  )
}
