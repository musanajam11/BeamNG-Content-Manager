import { useState, useEffect } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppLogo } from './AppLogo'

export function Titlebar(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    window.api.isMaximized().then(setMaximized)
    const cleanup = window.api.onMaximizedChange(setMaximized)
    return cleanup
  }, [])

  return (
    <div className="titlebar-drag flex items-center h-[38px] shrink-0 bg-transparent border-b border-[var(--border)] select-none">
      <div className="titlebar-no-drag flex items-center px-4">
        <AppLogo height={20} />
      </div>

      <div className="flex-1" />

      <div className="titlebar-no-drag flex h-full">
        <button
          onClick={() => window.api.minimizeWindow()}
          className="flex items-center justify-center w-12 h-full hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-none"
          aria-label={t('titlebar.minimize')}
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => window.api.maximizeWindow()}
          className="flex items-center justify-center w-12 h-full hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-none"
          aria-label={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
        >
          {maximized ? <Copy size={11} /> : <Square size={11} />}
        </button>
        <button
          onClick={() => window.api.closeWindow()}
          className="flex items-center justify-center w-12 h-full hover:bg-rose-500/80 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-none"
          aria-label={t('titlebar.close')}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
