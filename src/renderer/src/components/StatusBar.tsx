import { useState, useEffect } from 'react'

interface VersionInfo {
  appVersion: string
  gameVersion: string | null
  launcherVersion: string
  serverVersion: string | null
}

export function StatusBar(): React.JSX.Element {
  const [versions, setVersions] = useState<VersionInfo | null>(null)

  useEffect(() => {
    window.api.getVersions().then(setVersions).catch(() => {})
  }, [])

  return (
    <div className="flex items-center justify-between h-[22px] shrink-0 border-t border-[var(--color-border)] bg-black/30 text-[10px] text-[var(--color-text-muted)] select-none" style={{ paddingLeft: '12px', paddingRight: '12px' }}>
      <div className="flex items-center gap-3">
        {versions?.gameVersion && (
          <span>BeamNG <span className="text-[var(--color-text-secondary)]">{versions.gameVersion}</span></span>
        )}
        <span>BeamMP Client <span className="text-[var(--color-text-secondary)]">{versions?.launcherVersion ?? '—'}</span> Server <span className="text-[var(--color-text-secondary)]">{versions?.serverVersion ?? '—'}</span></span>
      </div>

      <span className="text-[var(--color-text-muted)]">
        Made with <span className="text-red-400">❤️</span>
      </span>

      <div className="flex items-center gap-3">
        <span>BeamNG CM <span className="text-[var(--color-accent)]">{versions?.appVersion ?? '—'}</span></span>
      </div>
    </div>
  )
}
