import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, Save, Loader2 } from 'lucide-react'
import type { DynamicTrafficConfig } from '../../../../preload/index.d'

interface Props {
  serverId: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'not-installed' }
  | { status: 'missing-config' }
  | { status: 'ready'; config: DynamicTrafficConfig }
  | { status: 'error'; message: string }

/**
 * Renders an editor for `Resources/Server/CareerMPTraffic/settings.txt` of a
 * hosted BeamMP server. Hidden entirely when BeamMP Dynamic Traffic is not
 * installed. When installed but the plugin hasn't generated settings.txt yet
 * (happens before the server's first run), shows an instructional notice
 * instead of a form. Admins block in the file is round-tripped verbatim.
 */
export function DynamicTrafficConfigSection({ serverId }: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const res = await window.api.dynamicTrafficGetConfig(serverId)
      if (!res.installed) { setState({ status: 'not-installed' }); return }
      if (!res.exists || !res.config) { setState({ status: 'missing-config' }); return }
      setState({ status: 'ready', config: res.config })
    } catch (e) {
      setState({ status: 'error', message: String(e) })
    }
  }, [serverId])

  useEffect(() => { load() }, [load])

  if (state.status === 'not-installed') return null

  const update = <K extends keyof DynamicTrafficConfig>(key: K, value: DynamicTrafficConfig[K]): void => {
    if (state.status !== 'ready') return
    setState({ status: 'ready', config: { ...state.config, [key]: value } })
    setSaveMessage(null)
  }

  const handleSave = async (): Promise<void> => {
    if (state.status !== 'ready') return
    setSaving(true)
    setSaveMessage(null)
    try {
      const res = await window.api.dynamicTrafficSaveConfig(serverId, state.config)
      if (res.success) setSaveMessage(t('serverManager.dynamicTrafficConfig.saved'))
      else setSaveMessage(res.error ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-6 p-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)] max-w-4xl">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {t('serverManager.dynamicTrafficConfig.title')}
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            {t('serverManager.dynamicTrafficConfig.blurb')}
          </p>
        </div>
      </div>

      {state.status === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <Loader2 size={14} className="animate-spin" />
          {t('serverManager.dynamicTrafficConfig.loading')}
        </div>
      )}

      {state.status === 'missing-config' && (
        <div className="flex items-start gap-2 p-3 rounded border border-amber-500/30 bg-amber-500/5">
          <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-200">
            {t('serverManager.dynamicTrafficConfig.missing')}
          </div>
        </div>
      )}

      {state.status === 'error' && (
        <div className="text-xs text-red-400">{state.message}</div>
      )}

      {state.status === 'ready' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-text-muted)]">
                {t('serverManager.dynamicTrafficConfig.aisPerPlayer')}
              </span>
              <input
                type="number"
                min={0}
                value={state.config.aisPerPlayer}
                onChange={(e) => update('aisPerPlayer', Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="px-2 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-border-accent)] outline-none rounded"
              />
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {t('serverManager.dynamicTrafficConfig.aisPerPlayerHint')}
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-text-muted)]">
                {t('serverManager.dynamicTrafficConfig.maxServerTraffic')}
              </span>
              <input
                type="number"
                min={0}
                value={state.config.maxServerTraffic}
                onChange={(e) => update('maxServerTraffic', Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="px-2 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-border-accent)] outline-none rounded"
              />
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {t('serverManager.dynamicTrafficConfig.maxServerTrafficHint')}
              </span>
            </label>

            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
              <input
                type="checkbox"
                checked={state.config.trafficGhosting}
                onChange={(e) => update('trafficGhosting', e.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              {t('serverManager.dynamicTrafficConfig.trafficGhosting')}
            </label>

            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
              <input
                type="checkbox"
                checked={state.config.trafficSpawnWarnings}
                onChange={(e) => update('trafficSpawnWarnings', e.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              {t('serverManager.dynamicTrafficConfig.trafficSpawnWarnings')}
            </label>
          </div>

          <p className="text-[11px] text-[var(--color-text-muted)]">
            {t('serverManager.dynamicTrafficConfig.adminsHint')}
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? t('serverManager.configSaving') : t('serverManager.dynamicTrafficConfig.save')}
            </button>
            {saveMessage && (
              <span className="text-xs text-[var(--color-text-muted)]">{saveMessage}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
