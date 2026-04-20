import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, Save, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import type { CareerMPServerConfig } from '../../../../preload/index.d'

interface Props {
  serverId: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'not-installed' }
  | { status: 'missing-config' }
  | { status: 'ready'; config: CareerMPServerConfig }
  | { status: 'error'; message: string }

/**
 * Renders an editor for `Resources/Server/CareerMP/config/config.json` of a
 * hosted BeamMP server. Hidden entirely when CareerMP is not installed for
 * the given server. When CareerMP is installed but the config file hasn't
 * been generated yet (happens before the server's first run), shows an
 * instructional notice instead of a form.
 */
export function CareerMPConfigSection({ serverId }: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [clientOpen, setClientOpen] = useState(false)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const res = await window.api.careerMPGetServerConfig(serverId)
      if (!res.installed) { setState({ status: 'not-installed' }); return }
      if (!res.exists || !res.config) { setState({ status: 'missing-config' }); return }
      setState({ status: 'ready', config: res.config })
    } catch (e) {
      setState({ status: 'error', message: String(e) })
    }
  }, [serverId])

  useEffect(() => { load() }, [load])

  if (state.status === 'not-installed') return null

  const updateServer = (key: keyof CareerMPServerConfig['server'], value: unknown): void => {
    if (state.status !== 'ready') return
    setState({ status: 'ready', config: { ...state.config, server: { ...state.config.server, [key]: value } } })
    setSaveMessage(null)
  }

  const updateClient = (key: keyof CareerMPServerConfig['client'], value: unknown): void => {
    if (state.status !== 'ready') return
    setState({ status: 'ready', config: { ...state.config, client: { ...state.config.client, [key]: value } } })
    setSaveMessage(null)
  }

  const handleSave = async (): Promise<void> => {
    if (state.status !== 'ready') return
    setSaving(true)
    setSaveMessage(null)
    try {
      const res = await window.api.careerMPSaveServerConfig(serverId, state.config)
      if (res.success) setSaveMessage(t('serverManager.careerMPConfig.saved'))
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
            {t('serverManager.careerMPConfig.title')}
          </h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            {t('serverManager.careerMPConfig.blurb')}
          </p>
        </div>
      </div>

      {state.status === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <Loader2 size={14} className="animate-spin" />
          {t('serverManager.careerMPConfig.loading')}
        </div>
      )}

      {state.status === 'missing-config' && (
        <div className="flex items-start gap-2 p-3 rounded border border-amber-500/30 bg-amber-500/5">
          <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-200">
            {t('serverManager.careerMPConfig.missing')}
          </div>
        </div>
      )}

      {state.status === 'error' && (
        <div className="text-xs text-red-400">{state.message}</div>
      )}

      {state.status === 'ready' && (
        <div className="space-y-5">
          {/* Server section */}
          <div>
            <h4 className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
              {t('serverManager.careerMPConfig.serverSection')}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {boolField(t('serverManager.careerMPConfig.allowTransactions'), state.config.server.allowTransactions, (v) => updateServer('allowTransactions', v))}
              {boolField(t('serverManager.careerMPConfig.autoUpdate'), state.config.server.autoUpdate, (v) => updateServer('autoUpdate', v))}
              {boolField(t('serverManager.careerMPConfig.autoRestart'), state.config.server.autoRestart, (v) => updateServer('autoRestart', v))}
              {numField(t('serverManager.careerMPConfig.sessionSendingMax'), state.config.server.sessionSendingMax, (v) => updateServer('sessionSendingMax', v))}
              {numField(t('serverManager.careerMPConfig.sessionReceiveMax'), state.config.server.sessionReceiveMax, (v) => updateServer('sessionReceiveMax', v))}
              {numField(t('serverManager.careerMPConfig.shortWindowMax'), state.config.server.shortWindowMax, (v) => updateServer('shortWindowMax', v))}
              {numField(t('serverManager.careerMPConfig.shortWindowSeconds'), state.config.server.shortWindowSeconds, (v) => updateServer('shortWindowSeconds', v))}
              {numField(t('serverManager.careerMPConfig.longWindowMax'), state.config.server.longWindowMax, (v) => updateServer('longWindowMax', v))}
              {numField(t('serverManager.careerMPConfig.longWindowSeconds'), state.config.server.longWindowSeconds, (v) => updateServer('longWindowSeconds', v))}
            </div>
          </div>

          {/* Client section (collapsible — this is the config pushed to connected players) */}
          <div>
            <button
              type="button"
              onClick={() => setClientOpen((o) => !o)}
              className="flex items-center gap-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] mb-2"
            >
              {clientOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {t('serverManager.careerMPConfig.clientSection')}
            </button>
            {clientOpen && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {textField(t('serverManager.careerMPConfig.serverSaveName'), state.config.client.serverSaveName, (v) => updateClient('serverSaveName', v))}
                {textField(t('serverManager.careerMPConfig.serverSaveSuffix'), state.config.client.serverSaveSuffix, (v) => updateClient('serverSaveSuffix', v))}
                {boolField(t('serverManager.careerMPConfig.serverSaveNameEnabled'), state.config.client.serverSaveNameEnabled, (v) => updateClient('serverSaveNameEnabled', v))}
                {boolField(t('serverManager.careerMPConfig.roadTrafficEnabled'), state.config.client.roadTrafficEnabled, (v) => updateClient('roadTrafficEnabled', v))}
                {numField(t('serverManager.careerMPConfig.roadTrafficAmount'), state.config.client.roadTrafficAmount, (v) => updateClient('roadTrafficAmount', v))}
                {boolField(t('serverManager.careerMPConfig.parkedTrafficEnabled'), state.config.client.parkedTrafficEnabled, (v) => updateClient('parkedTrafficEnabled', v))}
                {numField(t('serverManager.careerMPConfig.parkedTrafficAmount'), state.config.client.parkedTrafficAmount, (v) => updateClient('parkedTrafficAmount', v))}
                {boolField(t('serverManager.careerMPConfig.trafficSmartSelections'), state.config.client.trafficSmartSelections, (v) => updateClient('trafficSmartSelections', v))}
                {boolField(t('serverManager.careerMPConfig.trafficSimpleVehicles'), state.config.client.trafficSimpleVehicles, (v) => updateClient('trafficSimpleVehicles', v))}
                {boolField(t('serverManager.careerMPConfig.trafficAllowMods'), state.config.client.trafficAllowMods, (v) => updateClient('trafficAllowMods', v))}
                {boolField(t('serverManager.careerMPConfig.simplifyRemoteVehicles'), state.config.client.simplifyRemoteVehicles, (v) => updateClient('simplifyRemoteVehicles', v))}
                {numField(t('serverManager.careerMPConfig.spawnVehicleIgnitionLevel'), state.config.client.spawnVehicleIgnitionLevel, (v) => updateClient('spawnVehicleIgnitionLevel', v))}
                {boolField(t('serverManager.careerMPConfig.skipOtherPlayersVehicles'), state.config.client.skipOtherPlayersVehicles, (v) => updateClient('skipOtherPlayersVehicles', v))}
                {boolField(t('serverManager.careerMPConfig.allGhost'), state.config.client.allGhost, (v) => updateClient('allGhost', v))}
                {boolField(t('serverManager.careerMPConfig.unicycleGhost'), state.config.client.unicycleGhost, (v) => updateClient('unicycleGhost', v))}
                {boolField(t('serverManager.careerMPConfig.worldEditorEnabled'), state.config.client.worldEditorEnabled, (v) => updateClient('worldEditorEnabled', v))}
                {boolField(t('serverManager.careerMPConfig.consoleEnabled'), state.config.client.consoleEnabled, (v) => updateClient('consoleEnabled', v))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? t('serverManager.configSaving') : t('serverManager.careerMPConfig.save')}
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

function boolField(label: string, value: boolean, onChange: (v: boolean) => void): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--color-accent)]"
      />
      {label}
    </label>
  )
}

function numField(label: string, value: number, onChange: (v: number) => void): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="px-2 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-border-accent)] outline-none rounded"
      />
    </label>
  )
}

function textField(label: string, value: string, onChange: (v: string) => void): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-accent)] outline-none rounded"
      />
    </label>
  )
}
