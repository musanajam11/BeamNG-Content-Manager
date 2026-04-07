import { Gamepad2, Keyboard, Construction, Disc3, MousePointer, Gauge } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ControlsPage(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="relative">
        <Gamepad2 size={64} className="text-[var(--color-accent)] opacity-40" />
        <Construction
          size={24}
          className="absolute -bottom-1 -right-1 text-amber-400"
        />
      </div>

      <div className="space-y-2 max-w-md">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('controls.title')}</h1>
        <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
          {t('controls.description')}
        </p>
      </div>

      <div className="grid gap-3 max-w-sm w-full text-left">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-[var(--color-border)]">
          <Keyboard size={18} className="text-[var(--color-accent)] mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('controls.keyboard')}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('controls.keyboardDesc')}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-[var(--color-border)]">
          <Gamepad2 size={18} className="text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('controls.gamepad')}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('controls.gamepadDesc')}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-[var(--color-border)]">
          <Disc3 size={18} className="text-blue-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('controls.wheel')}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('controls.wheelDesc')}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-[var(--color-border)]">
          <Gauge size={18} className="text-orange-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('controls.filters')}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('controls.filtersDesc')}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-[var(--color-border)]">
          <MousePointer size={18} className="text-purple-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('controls.perDevice')}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('controls.perDeviceDesc')}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20">
        <span className="text-xs font-medium text-amber-400">{t('common.comingSoon')}</span>
      </div>
    </div>
  )
}
