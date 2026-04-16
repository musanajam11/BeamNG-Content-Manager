import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface VersionInfo {
  appVersion: string
  gameVersion: string | null
  launcherVersion: string
  serverVersion: string | null
}

export function StatusBar(): React.JSX.Element {
  const [versions, setVersions] = useState<VersionInfo | null>(null)
  const { t } = useTranslation()

  useEffect(() => {
    window.api.getVersions().then(setVersions).catch(() => {})
  }, [])

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
