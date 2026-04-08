import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { FolderOpen, Globe, Check, AlertCircle, Package, Download, Upload, Palette, RotateCcw, Monitor, Type, Layers, Maximize2, PanelLeft, Eye, EyeOff, Image, X, Plus, Shuffle, Network, Languages, Terminal, Server, GripVertical, Code, AlertTriangle, ToggleLeft, ToggleRight, Copy, ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/useAppStore'
import { useThemeStore, ACCENT_PRESETS, BG_STYLES, DEFAULT_SIDEBAR_ORDER } from '../stores/useThemeStore'
import { ALL_NAV_ITEMS } from '../components/Sidebar'
import { LANGUAGES } from '../i18n'
import * as Flags from 'country-flag-icons/react/3x2'
import type { AppearanceSettings, AppPage } from '../../../shared/types'

const MonacoEditor = lazy(() => import('@monaco-editor/react').then(m => ({ default: m.default })))

type SettingsTab = 'general' | 'appearance' | 'customcss'

export function SettingsPage(): React.JSX.Element {
  const config = useAppStore((s) => s.config)
  const [tab, setTab] = useState<SettingsTab>('general')
  const { t } = useTranslation()

  return (
    <div className="flex flex-col h-full rounded-lg border border-[var(--color-border)] overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--color-border)]">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('settings.title')}</h1>
        <div className="flex gap-2 ml-4">
          {(['general', 'appearance', 'customcss'] as const).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`px-4 py-2 text-xs font-medium transition-colors ${
                tab === tabKey
                  ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-transparent'
              }`}
            >
              {tabKey === 'general' ? t('settings.general') : tabKey === 'appearance' ? t('settings.appearance') : t('settings.customCSSTab')}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'general' ? <GeneralSettings config={config} /> : tab === 'appearance' ? <AppearanceSettingsPanel /> : <CustomCSSPanel />}
      </div>
    </div>
  )
}

// ── Language Selector ──

function LanguageSelector(): React.JSX.Element {
  const { t, i18n } = useTranslation()

  const handleChange = async (code: string): Promise<void> => {
    await i18n.changeLanguage(code)
    await useAppStore.getState().saveConfig({ language: code })
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
        <Languages size={16} />
        {t('settings.language')}
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => handleChange(lang.code)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
              i18n.language === lang.code
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {(() => {
              const FlagComponent = Flags[lang.countryCode as keyof typeof Flags]
              return FlagComponent ? <FlagComponent className="w-5 h-auto rounded-sm shrink-0" /> : null
            })()}
            <span className="font-medium">{lang.nativeName}</span>
            {i18n.language === lang.code && <Check size={14} className="ml-auto" />}
          </button>
        ))}
      </div>
    </section>
  )
}

// ── General Settings Tab ──

function GeneralSettings({ config }: { config: ReturnType<typeof useAppStore.getState>['config'] }): React.JSX.Element {
  const { t } = useTranslation()
  const [backendUrl, setBackendUrl] = useState(config?.backendUrl || '')
  const [authUrl, setAuthUrl] = useState(config?.authUrl || '')
  const [useOfficialBackend, setUseOfficialBackend] = useState(config?.useOfficialBackend ?? true)
  const [backendHealthy, setBackendHealthy] = useState<boolean | null>(null)
  const [installDir, setInstallDir] = useState(config?.gamePaths?.installDir || '')
  const [userDir, setUserDir] = useState(config?.gamePaths?.userDir || '')
  const [saved, setSaved] = useState(false)
  const [defaultPorts, setDefaultPorts] = useState(config?.defaultPorts || '')

  const [repos, setRepos] = useState<Array<{ name: string; url: string; priority: number }>>([])
  const [reposSaved, setReposSaved] = useState(false)
  const [modpackName, setModpackName] = useState('')
  const [modpackStatus, setModpackStatus] = useState<string | null>(null)
  const [customServerExe, setCustomServerExe] = useState(config?.customServerExe || '')

  useEffect(() => {
    if (config) {
      setBackendUrl(config.backendUrl)
      setAuthUrl(config.authUrl ?? '')
      setUseOfficialBackend(config.useOfficialBackend ?? true)
      setInstallDir(config.gamePaths?.installDir ?? '')
      setUserDir(config.gamePaths?.userDir ?? '')
      setDefaultPorts(config.defaultPorts ?? '')
      setCustomServerExe(config.customServerExe ?? '')
    }
  }, [config])

  useEffect(() => {
    window.api.registryGetRepositories().then(setRepos).catch(() => {})
  }, [])

  const checkHealth = async (): Promise<void> => {
    try {
      const healthy = await window.api.checkBackendHealth()
      setBackendHealthy(healthy)
    } catch {
      setBackendHealthy(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    // Save backend toggle
    if (useOfficialBackend !== (config?.useOfficialBackend ?? true)) {
      await window.api.setUseOfficialBackend(useOfficialBackend)
    }
    if (backendUrl !== config?.backendUrl) {
      await window.api.setBackendUrl(backendUrl)
    }
    if (authUrl !== (config?.authUrl ?? '')) {
      await window.api.setAuthUrl(authUrl)
    }
    if (installDir && userDir) {
      await window.api.setCustomPaths(installDir, userDir)
    }
    if (defaultPorts !== (config?.defaultPorts ?? '')) {
      await window.api.updateConfig({ defaultPorts })
    }
    const newServerExe = customServerExe.trim() || null
    if (newServerExe !== (config?.customServerExe ?? null)) {
      await window.api.updateConfig({ customServerExe: newServerExe })
    }
    await useAppStore.getState().loadConfig()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleAutoDetect = async (): Promise<void> => {
    const paths = await window.api.discoverPaths()
    if (paths) {
      setInstallDir(paths.installDir ?? '')
      setUserDir(paths.userDir ?? '')
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex flex-col gap-8">
        {/* Language */}
        <LanguageSelector />

        {/* Game Paths */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <FolderOpen size={16} />
            {t('settings.gamePaths')}
          </h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('settings.installDir')}</label>
                <input
                  type="text"
                  value={installDir}
                  onChange={(e) => setInstallDir(e.target.value)}
                  placeholder="C:\Program Files (x86)\Steam\steamapps\common\BeamNG.drive"
                  className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('settings.userDataDir')}</label>
                <input
                  type="text"
                  value={userDir}
                  onChange={(e) => setUserDir(e.target.value)}
                  placeholder="C:\Users\...\AppData\Local\BeamNG.drive"
                  className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
              <button
                onClick={handleAutoDetect}
                className="self-start text-xs text-[var(--color-accent)] hover:underline"
              >
                {t('settings.autoDetect')}
              </button>
            </div>
          </section>

          {/* Backend */}
          <section>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
              <Globe size={16} />
              {t('settings.backendServer')}
            </h2>

            {/* Official / Custom toggle */}
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => setUseOfficialBackend(!useOfficialBackend)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${useOfficialBackend ? 'bg-[var(--color-text-muted)]' : 'bg-[var(--color-accent)]'}`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${useOfficialBackend ? 'translate-x-0.5' : 'translate-x-[18px]'}`}
                />
              </button>
              <span className="text-sm text-[var(--color-text-secondary)]">
                {t('settings.useCustomBackend')}
              </span>
              <a
                href="https://github.com/musanajam11/Decentralized-BMP/tree/main"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--color-accent)] hover:underline"
              >
                {t('settings.whatsCustomBackend')}
              </a>
            </div>

            {!useOfficialBackend && (
              <div className="flex flex-col gap-3">
                {/* Backend URL */}
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('settings.backendUrl')}</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={backendUrl}
                      onChange={(e) => setBackendUrl(e.target.value)}
                      placeholder="https://backend.beammp.com"
                      className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
                    />
                    <button
                      onClick={checkHealth}
                      className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                    >
                      {t('common.test')}
                    </button>
                  </div>
                </div>
                {/* Auth URL */}
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('settings.authUrl')}</label>
                  <input
                    type="text"
                    value={authUrl}
                    onChange={(e) => setAuthUrl(e.target.value)}
                    placeholder="https://auth.beammp.com"
                    className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
                {backendHealthy !== null && (
                  <p
                    className={`text-xs flex items-center gap-1 ${backendHealthy ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {backendHealthy ? <Check size={12} /> : <AlertCircle size={12} />}
                    {backendHealthy ? t('settings.backendReachable') : t('settings.backendUnreachable')}
                  </p>
                )}
              </div>
            )}

            {useOfficialBackend && (
              <p className="text-xs text-[var(--color-text-muted)]">
                {t('settings.officialBackendActive')}
              </p>
            )}
          </section>

          {/* Default Server Ports */}
          <section>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
              <Network size={16} />
              {t('settings.defaultServerPorts')}
            </h2>
            <input
              type="text"
              value={defaultPorts}
              onChange={(e) => setDefaultPorts(e.target.value)}
              placeholder="e.g. 30814-30820, 31000"
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              {t('settings.defaultPortsDescription')}
            </p>
          </section>

          {/* Custom Executables */}
          <section>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
              <Terminal size={16} />
              {t('settings.customExecutables')}
            </h2>
            <p className="text-xs text-[var(--color-text-muted)] mb-4">
              {t('settings.customExecutablesDesc')}
            </p>
            <div className="flex flex-col gap-4">
              {/* Custom Server Exe */}
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 flex items-center gap-1.5">
                  <Server size={12} />
                  {t('settings.customServerExe')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customServerExe}
                    onChange={(e) => setCustomServerExe(e.target.value)}
                    placeholder={t('settings.customServerExePlaceholder')}
                    className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                  <button
                    onClick={async () => {
                      const path = await window.api.browseServerExe()
                      if (path) setCustomServerExe(path)
                    }}
                    className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    <FolderOpen size={14} />
                  </button>
                  {customServerExe && (
                    <button
                      onClick={() => setCustomServerExe('')}
                      className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-red-400 hover:text-red-300 hover:bg-[var(--color-surface-hover)] transition-colors"
                      title={t('settings.revertToOfficial')}
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Save */}
          <button
            onClick={handleSave}
            className="self-start px-6 py-2 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium transition-colors"
          >
            {saved ? t('settings.saved') : t('settings.saveSettings')}
          </button>

          {/* Registry Settings */}
          <section>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
              <Package size={16} />
              {t('settings.modRegistry')}
            </h2>
            <div className="flex flex-col gap-3">
              {repos.map((repo, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={repo.name}
                    onChange={(e) => {
                      const updated = [...repos]
                      updated[i] = { ...updated[i], name: e.target.value }
                      setRepos(updated)
                    }}
                    placeholder={t('common.name')}
                    className="w-32 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                  <input
                    type="text"
                    value={repo.url}
                    onChange={(e) => {
                      const updated = [...repos]
                      updated[i] = { ...updated[i], url: e.target.value }
                      setRepos(updated)
                    }}
                    placeholder={t('settings.repoUrlPlaceholder')}
                    className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                  <button
                    onClick={() => setRepos(repos.filter((_, j) => j !== i))}
                    className="px-2 py-2 text-red-400 hover:text-red-300 text-sm"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <button
                  onClick={() => setRepos([...repos, { name: '', url: '', priority: repos.length }])}
                  className="text-xs text-[var(--color-accent)] hover:underline"
                >
                  {t('settings.addRepository')}
                </button>
                <button
                  onClick={async () => {
                    await window.api.registrySetRepositories(repos)
                    setReposSaved(true)
                    setTimeout(() => setReposSaved(false), 2000)
                  }}
                  className="text-xs text-[var(--color-accent)] hover:underline"
                >
                  {reposSaved ? t('settings.repositoriesSaved') : t('settings.saveRepositories')}
                </button>
              </div>
            </div>
          </section>

          {/* Modpack Export / Import */}
          <section>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
              <Download size={16} />
              {t('settings.modpackExportImport')}
            </h2>
            <div className="flex flex-col gap-3">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={modpackName}
                  onChange={(e) => setModpackName(e.target.value)}
                  placeholder={t('settings.modpackName')}
                  className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
                />
                <button
                  onClick={async () => {
                    if (!modpackName.trim()) return
                    const data = await window.api.registryExportModpack(modpackName.trim())
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${modpackName.trim().replace(/[^a-zA-Z0-9_-]/g, '_')}.beampack`
                    a.click()
                    URL.revokeObjectURL(url)
                    setModpackStatus(t('settings.exported'))
                    setTimeout(() => setModpackStatus(null), 2000)
                  }}
                  className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1"
                >
                  <Upload size={14} /> {t('settings.export')}
                </button>
              </div>
              <div className="flex gap-2 items-center">
                <label className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1 cursor-pointer">
                  <Download size={14} /> {t('settings.importModpack')}
                  <input
                    type="file"
                    accept=".beampack,.json"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const text = await file.text()
                      const result = await window.api.registryImportModpack(text)
                      if (result.error) {
                        setModpackStatus(t('settings.importError', { error: result.error }))
                      } else if (result.missing.length > 0) {
                        setModpackStatus(t('settings.modsFoundPartiallyAvailable', { found: result.identifiers.length, missing: result.missing.length }))
                      } else {
                        setModpackStatus(t('settings.readyToInstallMods', { count: result.identifiers.length }))
                      }
                      if (result.identifiers.length > 0) {
                        await window.api.registryInstall(result.identifiers)
                        setModpackStatus(t('settings.installedFromModpack', { count: result.identifiers.length }))
                      }
                      setTimeout(() => setModpackStatus(null), 5000)
                    }}
                  />
                </label>
              </div>
              {modpackStatus && (
                <p className="text-xs text-[var(--color-text-muted)]">{modpackStatus}</p>
              )}
            </div>
          </section>
        </div>
      </div>
  )
}

// ── Appearance Settings Tab ──

function AppearanceSettingsPanel(): React.JSX.Element {
  const { appearance, update, reset } = useThemeStore()
  const [customHex, setCustomHex] = useState(appearance.accentColor)
  const { t } = useTranslation()

  const inputClass =
    'w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]'

  return (
    <div className="max-w-2xl">
      <div className="flex flex-col gap-8">
        {/* Accent Color */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Palette size={16} />
            {t('settings.accentColor')}
          </h2>
          <div className="grid grid-cols-12 gap-1.5" style={{ marginBottom: 24 }}>
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.color}
                onClick={() => {
                  update({ accentColor: preset.color })
                  setCustomHex(preset.color)
                }}
                className={`group relative w-full aspect-square rounded-lg border-2 transition-all ${
                  appearance.accentColor === preset.color
                    ? 'border-white scale-110 shadow-lg'
                    : 'border-transparent hover:border-white/30 hover:scale-105'
                }`}
                style={{ backgroundColor: preset.color }}
                title={preset.name}
              >
                {appearance.accentColor === preset.color && (
                  <Check size={14} className="absolute inset-0 m-auto text-white drop-shadow" />
                )}
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <div
              className="w-8 h-8 rounded-lg border border-[var(--color-border)] shrink-0"
              style={{ backgroundColor: customHex }}
            />
            <input
              type="text"
              value={customHex}
              onChange={(e) => {
                setCustomHex(e.target.value)
                if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
                  update({ accentColor: e.target.value })
                }
              }}
              placeholder="#f97316"
              className={inputClass + ' font-mono'}
              maxLength={7}
            />
            <input
              type="color"
              value={appearance.accentColor}
              onChange={(e) => {
                update({ accentColor: e.target.value })
                setCustomHex(e.target.value)
              }}
              className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
            />
          </div>
        </section>

        {/* UI Scale */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Maximize2 size={16} />
            {t('settings.uiScale')}
          </h2>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0.75}
              max={1.5}
              step={0.05}
              value={appearance.uiScale}
              onChange={(e) => update({ uiScale: parseFloat(e.target.value) })}
              className="flex-1 accent-[var(--color-accent)]"
            />
            <span className="text-sm text-[var(--color-text-secondary)] w-12 text-right font-mono">
              {Math.round((appearance.uiScale / 1.1) * 100)}%
            </span>
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            {t('settings.uiScaleDesc')}
          </p>
        </section>

        {/* Font Size */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Type size={16} />
            {t('settings.fontSize')}
          </h2>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={12}
              max={20}
              step={1}
              value={appearance.fontSize}
              onChange={(e) => update({ fontSize: parseInt(e.target.value) })}
              className="flex-1 accent-[var(--color-accent)]"
            />
            <span className="text-sm text-[var(--color-text-secondary)] w-12 text-right font-mono">
              {appearance.fontSize}px
            </span>
          </div>
        </section>

        {/* Background Style */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Monitor size={16} />
            {t('settings.backgroundStyle')}
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(BG_STYLES) as Array<keyof typeof BG_STYLES>).map((key) => {
              const style = BG_STYLES[key]
              return (
                <button
                  key={key}
                  onClick={() => update({ backgroundStyle: key })}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    appearance.backgroundStyle === key
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-hover)]'
                  }`}
                >
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">{style.label}</span>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{style.description}</p>
                </button>
              )
            })}
          </div>
          {appearance.backgroundStyle === 'default' && (
            <div className="mt-3 flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('settings.gradientColor1')}</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={appearance.bgGradient1 || '#22d3ee'}
                    onChange={(e) => update({ bgGradient1: e.target.value })}
                    className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <input
                    type="text"
                    value={appearance.bgGradient1 || ''}
                    onChange={(e) => update({ bgGradient1: e.target.value || null })}
                    placeholder="auto"
                    className={inputClass + ' font-mono text-xs'}
                  />
                </div>
              </div>
              <div className="flex-1">
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('settings.gradientColor2')}</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={appearance.bgGradient2 || '#3b82f6'}
                    onChange={(e) => update({ bgGradient2: e.target.value })}
                    className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <input
                    type="text"
                    value={appearance.bgGradient2 || ''}
                    onChange={(e) => update({ bgGradient2: e.target.value || null })}
                    placeholder="auto"
                    className={inputClass + ' font-mono text-xs'}
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Background Image */}
        <BackgroundImageSection appearance={appearance} update={update} />

        {/* Surface & Border Opacity */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Layers size={16} />
            {t('settings.surfaceBorders')}
          </h2>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('settings.surfaceOpacity')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={appearance.surfaceOpacity}
                  onChange={(e) => update({ surfaceOpacity: parseFloat(e.target.value) })}
                  className="flex-1 accent-[var(--color-accent)]"
                />
                <span className="text-sm text-[var(--color-text-secondary)] w-12 text-right font-mono">
                  {appearance.surfaceOpacity.toFixed(1)}x
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('settings.borderOpacity')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={appearance.borderOpacity}
                  onChange={(e) => update({ borderOpacity: parseFloat(e.target.value) })}
                  className="flex-1 accent-[var(--color-accent)]"
                />
                <span className="text-sm text-[var(--color-text-secondary)] w-12 text-right font-mono">
                  {appearance.borderOpacity.toFixed(1)}x
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Blur Effect */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Eye size={16} />
            {t('settings.effects')}
          </h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <button
              onClick={() => update({ enableBlur: !appearance.enableBlur })}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                appearance.enableBlur
                  ? 'bg-[var(--color-accent)]'
                  : 'bg-[var(--color-surface-active)]'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  appearance.enableBlur ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
            <div>
              <span className="text-sm text-[var(--color-text-primary)]">{t('settings.blurEffects')}</span>
              <p className="text-xs text-[var(--color-text-muted)]">{t('settings.blurEffectsDesc')}</p>
            </div>
          </label>
        </section>

        {/* Sidebar Width */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <PanelLeft size={16} />
            {t('settings.sidebarWidth')}
          </h2>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={160}
              max={280}
              step={4}
              value={appearance.sidebarWidth}
              onChange={(e) => update({ sidebarWidth: parseInt(e.target.value) })}
              className="flex-1 accent-[var(--color-accent)]"
            />
            <span className="text-sm text-[var(--color-text-secondary)] w-12 text-right font-mono">
              {appearance.sidebarWidth}px
            </span>
          </div>
        </section>

        {/* Sidebar Layout */}
        <SidebarLayoutSection appearance={appearance} update={update} />

        {/* Reset */}
        <section>
          <button
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <RotateCcw size={14} />
            {t('settings.resetDefaults')}
          </button>
          <p className="text-xs text-[var(--color-text-muted)] mt-2">
            {t('settings.resetDefaultsDesc')}
          </p>
        </section>
      </div>
    </div>
  )
}

// ── Background Image Gallery Section ──

function BackgroundImageSection({ appearance, update }: {
  appearance: AppearanceSettings
  update: (partial: Partial<AppearanceSettings>) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [defaultPaths, setDefaultPaths] = useState<string[]>([])

  // Build the combined list: saved user list + bundled defaults (deduplicated)
  const allImages = (() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const p of appearance.bgImageList) {
      if (!seen.has(p)) { seen.add(p); result.push(p) }
    }
    for (const p of defaultPaths) {
      if (!seen.has(p)) { seen.add(p); result.push(p) }
    }
    return result
  })()

  // Load bundled default backgrounds on mount
  useEffect(() => {
    window.api.getDefaultBackgrounds().then((paths) => {
      setDefaultPaths(paths)
      // If user has no saved list yet, populate with defaults
      if (appearance.bgImageList.length === 0 && paths.length > 0) {
        update({ bgImageList: paths })
      }
    })
  }, [])

  // Load thumbnails for visible images
  useEffect(() => {
    for (const p of allImages) {
      if (thumbs[p]) continue
      window.api.loadBackgroundThumb(p).then((dataUrl) => {
        if (dataUrl) setThumbs((prev) => ({ ...prev, [p]: dataUrl }))
      })
    }
  }, [allImages.length])

  const addImage = useCallback(async () => {
    const path = await window.api.pickBackgroundImage()
    if (path && !appearance.bgImageList.includes(path)) {
      const newList = [...appearance.bgImageList, path]
      update({ bgImageList: newList, bgImagePath: path })
    } else if (path) {
      update({ bgImagePath: path })
    }
  }, [appearance.bgImageList, update])

  const removeFromList = useCallback((path: string) => {
    const newList = appearance.bgImageList.filter((p) => p !== path)
    const updates: Partial<AppearanceSettings> = { bgImageList: newList }
    if (appearance.bgImagePath === path) updates.bgImagePath = null
    update(updates)
    // If it's a default background, delete the file from disk and remove from defaults
    if (defaultPaths.includes(path)) {
      window.api.deleteDefaultBackground(path)
      setDefaultPaths((prev) => prev.filter((p) => p !== path))
    }
    setThumbs((prev) => {
      const next = { ...prev }
      delete next[path]
      return next
    })
  }, [appearance.bgImageList, appearance.bgImagePath, update, defaultPaths])

  const selectImage = useCallback((path: string) => {
    if (appearance.bgImagePath === path) {
      update({ bgImagePath: null })
    } else {
      update({ bgImagePath: path })
    }
  }, [appearance.bgImagePath, update])

  return (
    <section>
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
        <Image size={16} />
        {t('settings.backgroundImage')}
      </h2>
      <div className="flex flex-col gap-4">
        {/* Gallery grid */}
        <div className="grid grid-cols-4 gap-2">
          {allImages.map((path) => {
            const isActive = appearance.bgImagePath === path
            const fileName = path.split(/[\\/]/).pop() || ''
            return (
              <div
                key={path}
                className={`relative group cursor-pointer border-2 transition-all overflow-hidden aspect-[16/9] ${
                  isActive
                    ? 'border-[var(--color-accent)] shadow-[0_0_12px_var(--color-accent-40)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-accent-50)]'
                }`}
                onClick={() => selectImage(path)}
                title={fileName}
              >
                {thumbs[path] ? (
                  <img src={thumbs[path]} alt={fileName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-[var(--color-surface)]">
                    <Image size={16} className="text-[var(--color-text-dim)]" />
                  </div>
                )}
                {/* Active indicator */}
                {isActive && (
                  <div className="absolute bottom-1 left-1 bg-[var(--color-accent)] rounded-full p-0.5">
                    <Check size={10} className="text-white" />
                  </div>
                )}
                {/* Delete button (red X) — top-right */}
                <button
                  onClick={(e) => { e.stopPropagation(); removeFromList(path) }}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 hover:bg-red-600 rounded-full p-0.5"
                  title="Remove from list"
                >
                  <X size={10} className="text-red-400 hover:text-white" />
                </button>
              </div>
            )
          })}

          {/* Add image button */}
          <button
            onClick={addImage}
            className="aspect-[16/9] border-2 border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)] flex flex-col items-center justify-center gap-1 transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
          >
            <Plus size={16} />
            <span className="text-[10px]">{t('settings.addImage')}</span>
          </button>
        </div>

        {/* Cycle on launch toggle */}
        <div className="flex items-center justify-between p-3 bg-[var(--color-surface)] border border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <Shuffle size={14} className="text-[var(--color-accent)]" />
            <span className="text-xs text-[var(--color-text-primary)]">{t('settings.randomBgOnLaunch')}</span>
          </div>
          <button
            onClick={() => update({ bgCycleOnLaunch: !appearance.bgCycleOnLaunch })}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              appearance.bgCycleOnLaunch ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
            }`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              appearance.bgCycleOnLaunch ? 'left-[18px]' : 'left-0.5'
            }`} />
          </button>
        </div>

        {/* Active background file name */}
        {appearance.bgImagePath && (
          <p className="text-[11px] text-[var(--color-text-muted)] truncate">
            {t('settings.active')} {appearance.bgImagePath.split(/[\\/]/).pop()}
          </p>
        )}

        {/* Opacity & Blur controls */}
        {appearance.bgImagePath && (
          <>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('settings.imageOpacity')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0.05}
                  max={1.0}
                  step={0.05}
                  value={appearance.bgImageOpacity}
                  onChange={(e) => update({ bgImageOpacity: parseFloat(e.target.value) })}
                  className="flex-1 accent-[var(--color-accent)]"
                />
                <span className="text-sm text-[var(--color-text-secondary)] w-12 text-right font-mono">
                  {Math.round(appearance.bgImageOpacity * 100)}%
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('settings.imageBlur')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={appearance.bgImageBlur}
                  onChange={(e) => update({ bgImageBlur: parseInt(e.target.value) })}
                  className="flex-1 accent-[var(--color-accent)]"
                />
                <span className="text-sm text-[var(--color-text-secondary)] w-12 text-right font-mono">
                  {appearance.bgImageBlur}px
                </span>
              </div>
            </div>
          </>
        )}

        {/* Clear active background */}
        {appearance.bgImagePath && (
          <button
            onClick={() => update({ bgImagePath: null })}
            className="flex items-center gap-1 px-3 py-2 text-xs border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 transition w-fit"
          >
            <X size={12} />
            Clear Background
          </button>
        )}
      </div>
    </section>
  )
}

// ── Sidebar Layout Section (Appearance tab) ──

function SidebarLayoutSection({ appearance, update }: {
  appearance: AppearanceSettings
  update: (partial: Partial<AppearanceSettings>) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const dragItem = useRef<number | null>(null)
  const dragOverItem = useRef<number | null>(null)

  const allItems = ALL_NAV_ITEMS
  const order: AppPage[] = appearance.sidebarOrder?.length ? appearance.sidebarOrder : DEFAULT_SIDEBAR_ORDER
  const hidden = new Set(appearance.sidebarHidden ?? [])

  // Build ordered visible list + hidden list
  const visibleIds = order.filter((id) => !hidden.has(id) && allItems.some((n) => n.id === id))
  const hiddenIds = allItems.filter((n) => hidden.has(n.id)).map((n) => n.id)

  const handleDragStart = (index: number): void => {
    dragItem.current = index
  }
  const handleDragEnter = (index: number): void => {
    dragOverItem.current = index
  }
  const handleDragEnd = (): void => {
    if (dragItem.current === null || dragOverItem.current === null) return
    const reordered = [...visibleIds]
    const [dragged] = reordered.splice(dragItem.current, 1)
    reordered.splice(dragOverItem.current, 0, dragged)
    dragItem.current = null
    dragOverItem.current = null
    // Persist: full order = visible reordered + hidden items at end (so they maintain position if un-hidden)
    const fullOrder = [...reordered, ...hiddenIds]
    update({ sidebarOrder: fullOrder })
  }

  const toggleVisibility = (id: AppPage): void => {
    if (hidden.has(id)) {
      update({ sidebarHidden: [...hidden].filter((h) => h !== id) })
    } else {
      update({ sidebarHidden: [...hidden, id] })
    }
  }

  const resetSidebar = (): void => {
    update({ sidebarOrder: [...DEFAULT_SIDEBAR_ORDER], sidebarHidden: [] })
  }

  const getItem = (id: AppPage): typeof allItems[number] | undefined => allItems.find((n) => n.id === id)

  return (
    <section>
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
        <PanelLeft size={16} />
        {t('settings.sidebarLayout')}
      </h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-3">{t('settings.sidebarLayoutDesc')}</p>

      {/* Visible items — draggable */}
      <div className="flex flex-col gap-1 mb-3">
        {visibleIds.map((id, index) => {
          const item = getItem(id)
          if (!item) return null
          const Icon = item.icon
          return (
            <div
              key={id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragEnter={() => handleDragEnter(index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              className="flex items-center gap-3 px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] cursor-grab active:cursor-grabbing hover:bg-[var(--color-surface-hover)] transition-colors select-none"
            >
              <GripVertical size={14} className="text-[var(--color-text-muted)] shrink-0" />
              <Icon size={14} className="text-[var(--color-text-secondary)] shrink-0" />
              <span className="text-sm text-[var(--color-text-primary)] flex-1">{t(item.labelKey)}</span>
              <button
                onClick={() => toggleVisibility(id)}
                className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                title={t('settings.hideSidebarItem')}
              >
                <Eye size={14} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Hidden items */}
      {hiddenIds.length > 0 && (
        <>
          <p className="text-xs text-[var(--color-text-muted)] mb-2">{t('settings.hiddenItems')}</p>
          <div className="flex flex-col gap-1 mb-3">
            {hiddenIds.map((id) => {
              const item = getItem(id)
              if (!item) return null
              const Icon = item.icon
              return (
                <div
                  key={id}
                  className="flex items-center gap-3 px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] opacity-50"
                >
                  <div className="w-[14px]" />
                  <Icon size={14} className="text-[var(--color-text-muted)] shrink-0" />
                  <span className="text-sm text-[var(--color-text-muted)] flex-1 line-through">{t(item.labelKey)}</span>
                  <button
                    onClick={() => toggleVisibility(id)}
                    className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                    title={t('settings.showSidebarItem')}
                  >
                    <EyeOff size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}

      <button
        onClick={resetSidebar}
        className="flex items-center gap-2 px-3 py-1.5 text-xs border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        <RotateCcw size={12} />
        {t('settings.resetSidebar')}
      </button>
    </section>
  )
}

// ── Custom CSS Panel (own tab) ──

// ── CSS Snippet Templates ──

const CSS_SNIPPETS: { category: string; categoryKey: string; snippets: { name: string; nameKey: string; css: string }[] }[] = [
  {
    category: 'Sidebar',
    categoryKey: 'settings.cssCatSidebar',
    snippets: [
      {
        name: 'Rounded sidebar items',
        nameKey: 'settings.cssRoundedSidebarItems',
        css: `/* Rounded sidebar nav buttons */
aside button {
  border-radius: 12px;
}`
      },
      {
        name: 'Colored active indicator',
        nameKey: 'settings.cssColoredActive',
        css: `/* Glowing active sidebar item */
aside button[class*="bg-"] {
  box-shadow: inset 3px 0 0 var(--color-accent);
}`
      },
      {
        name: 'Wider sidebar',
        nameKey: 'settings.cssWiderSidebar',
        css: `/* Override sidebar width */
:root {
  --sidebar-width: 260px;
}`
      }
    ]
  },
  {
    category: 'Cards & Surfaces',
    categoryKey: 'settings.cssCatCards',
    snippets: [
      {
        name: 'Rounded cards',
        nameKey: 'settings.cssRoundedCards',
        css: `/* Rounded card corners */
.rounded-lg, .rounded-xl {
  border-radius: 16px !important;
}`
      },
      {
        name: 'Glow on hover',
        nameKey: 'settings.cssGlowHover',
        css: `/* Accent glow on card hover */
.rounded-lg:hover, .rounded-xl:hover {
  box-shadow: 0 0 20px var(--color-accent-25);
}`
      },
      {
        name: 'Remove all borders',
        nameKey: 'settings.cssNoBorders',
        css: `/* Borderless look */
* {
  border-color: transparent !important;
}`
      }
    ]
  },
  {
    category: 'Typography',
    categoryKey: 'settings.cssCatTypography',
    snippets: [
      {
        name: 'Monospace everywhere',
        nameKey: 'settings.cssMonospace',
        css: `/* Monospace font */
* {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace !important;
}`
      },
      {
        name: 'Larger text',
        nameKey: 'settings.cssLargerText',
        css: `/* Bump up base font size */
:root {
  font-size: 18px;
}`
      }
    ]
  },
  {
    category: 'Backgrounds & Effects',
    categoryKey: 'settings.cssCatEffects',
    snippets: [
      {
        name: 'Frosted glass panels',
        nameKey: 'settings.cssFrostedGlass',
        css: `/* Extra frosted glass effect */
[class*="bg-black/"], [class*="bg-white/"] {
  backdrop-filter: blur(20px) saturate(1.5);
}`
      },
      {
        name: 'Scanline overlay',
        nameKey: 'settings.cssScanlines',
        css: `/* CRT scanline effect */
#root::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  background: repeating-linear-gradient(
    transparent 0px,
    rgba(0,0,0,0.03) 1px,
    transparent 2px
  );
}`
      },
      {
        name: 'Hide background image',
        nameKey: 'settings.cssHideBg',
        css: `/* Remove background image */
[style*="background-image"] {
  background-image: none !important;
}`
      }
    ]
  },
  {
    category: 'Scrollbar',
    categoryKey: 'settings.cssCatScrollbar',
    snippets: [
      {
        name: 'Thin accent scrollbar',
        nameKey: 'settings.cssThinScrollbar',
        css: `/* Thin accent-colored scrollbar */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--color-accent);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--color-accent-hover);
}`
      },
      {
        name: 'Hide scrollbars',
        nameKey: 'settings.cssHideScrollbar',
        css: `/* Hide all scrollbars */
::-webkit-scrollbar {
  display: none;
}`
      }
    ]
  },
  {
    category: 'Animations',
    categoryKey: 'settings.cssCatAnimations',
    snippets: [
      {
        name: 'Disable all transitions',
        nameKey: 'settings.cssNoTransitions',
        css: `/* Instant UI — no animations */
*, *::before, *::after {
  transition-duration: 0s !important;
  animation-duration: 0s !important;
}`
      },
      {
        name: 'Smooth page fade',
        nameKey: 'settings.cssSmoothFade',
        css: `/* Fade-in on page content */
main > div {
  animation: fadeIn 0.2s ease-in;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}`
      }
    ]
  }
]

function CustomCSSPanel(): React.JSX.Element {
  const { appearance, update } = useThemeStore()
  const { t } = useTranslation()
  const [localCSS, setLocalCSS] = useState(appearance.customCSS ?? '')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [expandedCat, setExpandedCat] = useState<string | null>(null)
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null)

  const cssEnabled = appearance.customCSSEnabled !== false

  // Debounced save — apply live after 500ms of no typing
  const handleChange = (value: string | undefined): void => {
    const css = value ?? ''
    setLocalCSS(css)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      update({ customCSS: css })
    }, 500)
  }

  const handleClear = (): void => {
    setLocalCSS('')
    update({ customCSS: '' })
  }

  const toggleCSS = (): void => {
    update({ customCSSEnabled: !cssEnabled })
  }

  const insertSnippet = (css: string): void => {
    const newCSS = localCSS ? `${localCSS}\n\n${css}` : css
    setLocalCSS(newCSS)
    update({ customCSS: newCSS })
    setCopiedSnippet(css)
    setTimeout(() => setCopiedSnippet(null), 1500)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Warning banner */}
      <div className="flex items-start gap-3 px-4 py-3 mb-4 border border-yellow-500/20 bg-yellow-500/5">
        <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm text-yellow-300 font-medium">{t('settings.customCSSWarningTitle')}</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('settings.customCSSWarningDesc')}</p>
        </div>
      </div>

      {/* Header bar with toggle + clear */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
          <Code size={16} />
          {t('settings.customCSSEditor')}
        </h2>
        <div className="flex items-center gap-3">
          {/* Enable/Disable toggle */}
          <button
            onClick={toggleCSS}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border transition-colors ${
              cssEnabled
                ? 'border-[var(--color-accent-25)] text-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            {cssEnabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
            {cssEnabled ? t('settings.cssEnabled') : t('settings.cssDisabled')}
          </button>
          {/* Clear button */}
          <button
            onClick={handleClear}
            disabled={!localCSS}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-30"
          >
            <X size={12} />
            {t('settings.clearCSS')}
          </button>
        </div>
      </div>

      {!cssEnabled && localCSS && (
        <div className="flex items-center gap-2 px-3 py-2 mb-3 text-xs text-[var(--color-text-muted)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <EyeOff size={12} />
          {t('settings.cssDisabledNotice')}
        </div>
      )}

      {/* Side-by-side: Editor + Snippets */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Left — Editor */}
        <div className="flex-1 flex flex-col min-w-0">
          <p className="text-xs text-[var(--color-text-muted)] mb-2">{t('settings.customCSSDesc')}</p>
          <div className="flex-1 min-h-[400px] border border-[var(--color-border)] overflow-hidden">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">Loading editor...</div>}>
              <MonacoEditor
                height="100%"
                language="css"
                theme="vs-dark"
                value={localCSS}
                onChange={handleChange}
                options={{
                  fontSize: 13,
                  fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
                  fontLigatures: true,
                  minimap: { enabled: false },
                  tabSize: 2,
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  bracketPairColorization: { enabled: true },
                  padding: { top: 12, bottom: 12 },
                  lineNumbers: 'on',
                  renderLineHighlight: 'line',
                  suggestOnTriggerCharacters: true,
                  quickSuggestions: true,
                  folding: true
                }}
              />
            </Suspense>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-2">
            {t('settings.customCSSHint')}
          </p>
        </div>

        {/* Right — Snippet Templates */}
        <div className="w-[280px] shrink-0 flex flex-col min-h-0">
          <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">{t('settings.cssSnippets')}</p>
          <div className="flex-1 overflow-y-auto border border-[var(--color-border)] bg-black/20">
            {CSS_SNIPPETS.map((cat) => (
              <div key={cat.category}>
                <button
                  onClick={() => setExpandedCat(expandedCat === cat.category ? null : cat.category)}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors border-b border-[var(--color-border)]"
                >
                  {expandedCat === cat.category ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {t(cat.categoryKey)}
                </button>
                {expandedCat === cat.category && (
                  <div className="flex flex-col">
                    {cat.snippets.map((snippet) => (
                      <button
                        key={snippet.name}
                        onClick={() => insertSnippet(snippet.css)}
                        className="flex items-center gap-2 px-4 py-2 text-left text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors border-b border-[var(--color-border)]/50"
                      >
                        <Copy size={11} className="shrink-0 text-[var(--color-text-muted)]" />
                        <span className="flex-1">{t(snippet.nameKey)}</span>
                        {copiedSnippet === snippet.css && (
                          <Check size={12} className="text-green-400 shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-2">{t('settings.cssSnippetsHint')}</p>
        </div>
      </div>
    </div>
  )
}
