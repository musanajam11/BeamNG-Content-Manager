import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { FolderOpen, Globe, Check, AlertCircle, Package, Download, Upload, Palette, RotateCcw, Monitor, Type, Layers, Maximize2, PanelLeft, Eye, EyeOff, Image, X, Plus, Shuffle, Network, Languages, Terminal, Server, GripVertical, AlertTriangle, ToggleLeft, ToggleRight, ChevronDown, ChevronRight, Wrench, Trash2, Shield, HardDriveDownload, Loader2, Sun, Moon, SlidersHorizontal, Sparkles, Square, Circle, MousePointer, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/useAppStore'
import { useThemeStore, ACCENT_PRESETS, BG_STYLES, DEFAULT_SIDEBAR_ORDER } from '../stores/useThemeStore'
import { ALL_NAV_ITEMS } from '../components/Sidebar'
import { LANGUAGES } from '../i18n'
import * as Flags from 'country-flag-icons/react/3x2'
import type { AppearanceSettings, AppPage } from '../../../shared/types'

type SettingsTab = 'general' | 'appearance'

export function SettingsPage(): React.JSX.Element {
  const config = useAppStore((s) => s.config)
  const [tab, setTab] = useState<SettingsTab>('general')
  const { t } = useTranslation()

  return (
    <div className="flex flex-col h-full rounded-lg border border-[var(--color-border)] overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--color-border)]">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('settings.title')}</h1>
        <div className="flex gap-2 ml-4">
          {(['general', 'appearance'] as const).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`px-4 py-2 text-xs font-medium transition-colors ${
                tab === tabKey
                  ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-transparent'
              }`}
            >
              {tabKey === 'general' ? t('settings.general') : t('settings.appearance')}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'general' ? <GeneralSettings config={config} /> : <AppearanceSettingsPanel />}
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
  const [renderer, setRenderer] = useState<'ask' | 'dx11' | 'vulkan'>(config?.renderer ?? 'ask')

  useEffect(() => {
    if (config) {
      setBackendUrl(config.backendUrl)
      setAuthUrl(config.authUrl ?? '')
      setUseOfficialBackend(config.useOfficialBackend ?? true)
      setInstallDir(config.gamePaths?.installDir ?? '')
      setUserDir(config.gamePaths?.userDir ?? '')
      setDefaultPorts(config.defaultPorts ?? '')
      setCustomServerExe(config.customServerExe ?? '')
      setRenderer(config.renderer ?? 'ask')
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
    if (renderer !== (config?.renderer ?? 'ask')) {
      await window.api.updateConfig({ renderer })
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
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-[var(--color-text-primary)] transition-transform ${useOfficialBackend ? 'translate-x-0.5' : 'translate-x-[18px]'}`}
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

          {/* Game Launching */}
          <section>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
              <Monitor size={16} />
              {t('settings.gameLaunching')}
            </h2>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-2 block">{t('settings.renderer')}</label>
              <div className="flex gap-2">
                {(['ask', 'dx11', 'vulkan'] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setRenderer(opt)}
                    className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                      renderer === opt
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                    }`}
                  >
                    {opt === 'ask' ? t('settings.rendererAsk') : opt === 'dx11' ? 'DirectX 11' : 'Vulkan'}
                    {renderer === opt && <Check size={12} className="inline ml-1.5" />}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                {t('settings.rendererDescription')}
              </p>
            </div>
          </section>

          {/* Support Tools */}
          <SupportToolsSection />

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
            className="self-start px-6 py-2 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-[var(--color-text-primary)] text-sm font-medium transition-colors"
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

// ── Support Tools Section ──

function SupportToolsSection(): React.JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  const showStatus = (msg: string, durationMs = 4000): void => {
    setStatus(msg)
    setTimeout(() => setStatus(null), durationMs)
  }

  const handleOpenUserFolder = async (): Promise<void> => {
    const result = await window.api.openUserFolder()
    if (!result.success) showStatus(result.error ?? 'Failed')
  }

  const handleClearCache = async (): Promise<void> => {
    setClearing(true)
    try {
      const result = await window.api.clearCache()
      if (result.success) {
        const mb = result.freedBytes ? (result.freedBytes / 1024 / 1024).toFixed(1) : '0'
        showStatus(t('settings.cacheClearedMB', { mb }))
      } else {
        showStatus(result.error ?? 'Failed')
      }
    } finally {
      setClearing(false)
    }
  }

  const handleSafeMode = async (): Promise<void> => {
    const result = await window.api.launchSafeMode()
    if (result.success) showStatus(t('settings.safeModeStarted'))
    else showStatus(result.error ?? 'Failed')
  }

  const handleSafeVulkan = async (): Promise<void> => {
    const result = await window.api.launchSafeVulkan()
    if (result.success) showStatus(t('settings.safeVulkanStarted'))
    else showStatus(result.error ?? 'Failed')
  }

  const handleVerifyIntegrity = async (): Promise<void> => {
    const result = await window.api.verifyIntegrity()
    if (result.success) showStatus(t('settings.verifyTriggered'))
    else showStatus(result.error ?? 'Failed')
  }

  const btnClass = 'flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors text-left'

  return (
    <section>
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
        <Wrench size={16} />
        {t('settings.supportTools')}
      </h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-4">
        {t('settings.supportToolsDescription')}
      </p>
      <div className="flex flex-col gap-2">
        <button onClick={handleOpenUserFolder} className={btnClass}>
          <FolderOpen size={15} className="shrink-0 text-[var(--color-accent)]" />
          <div>
            <div className="font-medium text-[var(--color-text-primary)]">{t('settings.openUserFolder')}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{t('settings.openUserFolderDesc')}</div>
          </div>
        </button>
        <button onClick={handleClearCache} disabled={clearing} className={btnClass}>
          {clearing ? <Loader2 size={15} className="shrink-0 text-[var(--color-accent)] animate-spin" /> : <Trash2 size={15} className="shrink-0 text-[var(--color-accent)]" />}
          <div>
            <div className="font-medium text-[var(--color-text-primary)]">{t('settings.clearCache')}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{t('settings.clearCacheDesc')}</div>
          </div>
        </button>
        <button onClick={handleSafeMode} className={btnClass}>
          <Shield size={15} className="shrink-0 text-[var(--color-accent)]" />
          <div>
            <div className="font-medium text-[var(--color-text-primary)]">{t('settings.launchSafeMode')}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{t('settings.launchSafeModeDesc')}</div>
          </div>
        </button>
        <button onClick={handleSafeVulkan} className={btnClass}>
          <Shield size={15} className="shrink-0 text-[var(--color-accent)]" />
          <div>
            <div className="font-medium text-[var(--color-text-primary)]">{t('settings.launchSafeVulkan')}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{t('settings.launchSafeVulkanDesc')}</div>
          </div>
        </button>
        <button onClick={handleVerifyIntegrity} className={btnClass}>
          <HardDriveDownload size={15} className="shrink-0 text-[var(--color-accent)]" />
          <div>
            <div className="font-medium text-[var(--color-text-primary)]">{t('settings.verifyIntegrity')}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{t('settings.verifyIntegrityDesc')}</div>
          </div>
        </button>
      </div>
      {status && (
        <p className="mt-3 text-xs text-[var(--color-accent)] flex items-center gap-1">
          <Check size={12} /> {status}
        </p>
      )}
    </section>
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
        {/* Color Mode */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Sun size={16} />
            {t('settings.colorMode', 'Color Mode')}
          </h2>
          <div className="inline-flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            {([
              { value: 'dark' as const, label: t('settings.dark', 'Dark'), icon: Moon },
              { value: 'light' as const, label: t('settings.light', 'Light'), icon: Sun },
              { value: 'system' as const, label: t('settings.system', 'System'), icon: Monitor }
            ]).map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => update({ colorMode: value })}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
                  appearance.colorMode === value
                    ? 'bg-[var(--color-accent)] text-[var(--color-text-primary)]'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Accent Color */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Palette size={16} />
            {t('settings.accentColor')}
          </h2>
          <div className="grid grid-cols-12 gap-1.5 overflow-hidden p-1" style={{ marginBottom: 24 }}>
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.color}
                onClick={() => {
                  update({ accentColor: preset.color })
                  setCustomHex(preset.color)
                }}
                className={`group relative w-full aspect-square rounded-lg border-2 transition-all ${
                  appearance.accentColor === preset.color
                    ? 'border-[var(--color-text-primary)] scale-110 shadow-lg'
                    : 'border-transparent hover:border-[var(--color-border-hover)] hover:scale-105'
                }`}
                style={{ backgroundColor: preset.color }}
                title={preset.name}
              >
                {appearance.accentColor === preset.color && (
                  <Check size={14} className="absolute inset-0 m-auto text-[var(--color-text-primary)] drop-shadow" />
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
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-[var(--color-text-primary)] transition-transform ${
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

        {/* ═══ Visual Customization ═══ */}

        {/* Corner Radius */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Square size={16} />
            {t('settings.cornerRadius', 'Corner Radius')}
          </h2>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={24}
              step={4}
              value={appearance.cornerRadius ?? 0}
              onChange={(e) => update({ cornerRadius: parseInt(e.target.value) })}
              className="flex-1 accent-[var(--color-accent)]"
            />
            <span className="text-sm text-[var(--color-text-secondary)] w-12 text-right font-mono">
              {appearance.cornerRadius ?? 0}px
            </span>
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            {t('settings.cornerRadiusDesc', '0 = sharp edges, 24 = very round')}
          </p>
        </section>

        {/* Button Size */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <MousePointer size={16} />
            {t('settings.buttonSize', 'Button Size')}
          </h2>
          <div className="inline-flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            {([
              { value: 'default' as const, label: t('settings.btnDefault', 'Default') },
              { value: 'comfortable' as const, label: t('settings.btnComfortable', 'Comfortable') },
              { value: 'large' as const, label: t('settings.btnLarge', 'Large') }
            ]).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => update({ buttonSize: value })}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  (appearance.buttonSize ?? 'default') === value
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            {t('settings.buttonSizeDesc', 'Increases button height and text size for easier clicking')}
          </p>
        </section>

        {/* Font Family */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Type size={16} />
            {t('settings.fontFamily', 'Font Family')}
          </h2>
          <div className="inline-flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            {([
              { value: 'system' as const, label: t('settings.fontSystem', 'System'), sample: 'Segoe UI' },
              { value: 'monospace' as const, label: t('settings.fontMono', 'Monospace'), sample: 'JetBrains Mono' },
              { value: 'serif' as const, label: t('settings.fontSerif', 'Serif'), sample: 'Georgia' }
            ]).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => update({ fontFamily: value })}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  (appearance.fontFamily ?? 'system') === value
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Scrollbar Style */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <SlidersHorizontal size={16} />
            {t('settings.scrollbarStyle', 'Scrollbar Style')}
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'default' as const, label: t('settings.scrollDefault', 'Default'), desc: t('settings.scrollDefaultDesc', 'Thin subtle scrollbar') },
              { value: 'thin-accent' as const, label: t('settings.scrollThinAccent', 'Accent'), desc: t('settings.scrollThinAccentDesc', 'Thin accent-colored') },
              { value: 'rounded' as const, label: t('settings.scrollRounded', 'Rounded'), desc: t('settings.scrollRoundedDesc', 'Chunky rounded scrollbar') },
              { value: 'hidden' as const, label: t('settings.scrollHidden', 'Hidden'), desc: t('settings.scrollHiddenDesc', 'No visible scrollbar') }
            ]).map(({ value, label, desc }) => (
              <button
                key={value}
                onClick={() => update({ scrollbarStyle: value })}
                className={`p-3 rounded-lg border text-left transition-all ${
                  (appearance.scrollbarStyle ?? 'rounded') === value
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-hover)]'
                }`}
              >
                <span className="text-sm font-medium text-[var(--color-text-primary)]">{label}</span>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{desc}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Animation Speed */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Zap size={16} />
            {t('settings.animationSpeed', 'Animation Speed')}
          </h2>
          <div className="inline-flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            {([
              { value: 'none' as const, label: t('settings.animNone', 'Instant') },
              { value: 'normal' as const, label: t('settings.animNormal', 'Normal') },
              { value: 'slow' as const, label: t('settings.animSlow', 'Relaxed') }
            ]).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => update({ animationSpeed: value })}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  (appearance.animationSpeed ?? 'normal') === value
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Border Style */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Layers size={16} />
            {t('settings.borderStyleLabel', 'Border Style')}
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'normal' as const, label: t('settings.borderNormal', 'Normal'), desc: t('settings.borderNormalDesc', 'Default subtle borders') },
              { value: 'none' as const, label: t('settings.borderNone', 'Borderless'), desc: t('settings.borderNoneDesc', 'Clean, no borders') },
              { value: 'thick' as const, label: t('settings.borderThick', 'Bold'), desc: t('settings.borderThickDesc', 'Heavier 2px borders') },
              { value: 'accent' as const, label: t('settings.borderAccent', 'Accent'), desc: t('settings.borderAccentDesc', 'Accent-tinted borders') }
            ]).map(({ value, label, desc }) => (
              <button
                key={value}
                onClick={() => update({ borderStyle: value })}
                className={`p-3 rounded-lg border text-left transition-all ${
                  (appearance.borderStyle ?? 'normal') === value
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-hover)]'
                }`}
              >
                <span className="text-sm font-medium text-[var(--color-text-primary)]">{label}</span>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{desc}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Overlay Effect */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Sparkles size={16} />
            {t('settings.overlayEffect', 'Overlay Effect')}
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'none' as const, label: t('settings.overlayNone', 'None') },
              { value: 'scanlines' as const, label: t('settings.overlayScanlines', 'Scanlines') },
              { value: 'vignette' as const, label: t('settings.overlayVignette', 'Vignette') },
              { value: 'noise' as const, label: t('settings.overlayNoise', 'Film Grain') }
            ]).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => update({ overlayEffect: value })}
                className={`px-4 py-2.5 rounded-lg border text-center text-sm font-medium transition-all ${
                  (appearance.overlayEffect ?? 'none') === value
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Visual Effects Toggles */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <MousePointer size={16} />
            {t('settings.visualEffects', 'Visual Effects')}
          </h2>
          <div className="flex flex-col gap-3">
            {([
              { key: 'effectPageFade' as const, label: t('settings.effectPageFade', 'Page fade-in'), desc: t('settings.effectPageFadeDesc', 'Smooth fade animation when switching pages') },
              { key: 'effectAccentSelection' as const, label: t('settings.effectAccentSelection', 'Accent text selection'), desc: t('settings.effectAccentSelectionDesc', 'Highlight selected text with your accent color') },
              { key: 'effectFrostedGlass' as const, label: t('settings.effectFrostedGlass', 'Frosted glass panels'), desc: t('settings.effectFrostedGlassDesc', 'Extra blur + saturation on overlay panels') },
              { key: 'effectHoverGlow' as const, label: t('settings.effectHoverGlow', 'Hover glow'), desc: t('settings.effectHoverGlowDesc', 'Accent glow effect when hovering cards') },
              { key: 'effectHoverLift' as const, label: t('settings.effectHoverLift', 'Hover lift'), desc: t('settings.effectHoverLiftDesc', 'Cards lift slightly when hovered') }
            ] as const).map(({ key, label, desc }) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer">
                <button
                  onClick={() => update({ [key]: !(appearance[key] ?? false) })}
                  className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
                    (appearance[key] ?? false)
                      ? 'bg-[var(--color-accent)]'
                      : 'bg-[var(--color-surface-active)]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-[var(--color-text-primary)] transition-transform ${
                      (appearance[key] ?? false) ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </button>
                <div>
                  <span className="text-sm text-[var(--color-text-primary)]">{label}</span>
                  <p className="text-xs text-[var(--color-text-muted)]">{desc}</p>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Color Filters */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Circle size={16} />
            {t('settings.colorFilters', 'Color Filters')}
          </h2>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('settings.brightness', 'Brightness')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={0.7} max={1.3} step={0.05}
                  value={appearance.filterBrightness ?? 1.0}
                  onChange={(e) => update({ filterBrightness: parseFloat(e.target.value) })}
                  className="flex-1 accent-[var(--color-accent)]"
                />
                <span className="text-sm text-[var(--color-text-secondary)] w-12 text-right font-mono">
                  {((appearance.filterBrightness ?? 1.0) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('settings.contrast', 'Contrast')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={0.7} max={1.5} step={0.05}
                  value={appearance.filterContrast ?? 1.0}
                  onChange={(e) => update({ filterContrast: parseFloat(e.target.value) })}
                  className="flex-1 accent-[var(--color-accent)]"
                />
                <span className="text-sm text-[var(--color-text-secondary)] w-12 text-right font-mono">
                  {((appearance.filterContrast ?? 1.0) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('settings.saturation', 'Saturation')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={0} max={2.0} step={0.05}
                  value={appearance.filterSaturation ?? 1.0}
                  onChange={(e) => update({ filterSaturation: parseFloat(e.target.value) })}
                  className="flex-1 accent-[var(--color-accent)]"
                />
                <span className="text-sm text-[var(--color-text-secondary)] w-12 text-right font-mono">
                  {((appearance.filterSaturation ?? 1.0) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            {((appearance.filterBrightness ?? 1.0) !== 1.0 || (appearance.filterContrast ?? 1.0) !== 1.0 || (appearance.filterSaturation ?? 1.0) !== 1.0) && (
              <button
                onClick={() => update({ filterBrightness: 1.0, filterContrast: 1.0, filterSaturation: 1.0 })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors w-fit"
              >
                <RotateCcw size={12} />
                {t('settings.resetFilters', 'Reset filters')}
              </button>
            )}
          </div>
        </section>

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

  // Extract filename from a full path (handles both / and \)
  const basename = (p: string): string => p.replace(/\\/g, '/').split('/').pop()!.toLowerCase()

  // Build the combined list: saved user list + bundled defaults (deduplicated by filename)
  const allImages = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const p of appearance.bgImageList) {
      const name = basename(p)
      if (!seen.has(name)) { seen.add(name); result.push(p) }
    }
    for (const p of defaultPaths) {
      const name = basename(p)
      if (!seen.has(name)) { seen.add(name); result.push(p) }
    }
    return result
  }, [appearance.bgImageList, defaultPaths])

  // Load bundled default backgrounds on mount; reconcile stale paths from previous installs
  useEffect(() => {
    window.api.getDefaultBackgrounds().then((paths) => {
      setDefaultPaths(paths)
      if (appearance.bgImageList.length === 0 && paths.length > 0) {
        // First run: populate with defaults
        update({ bgImageList: paths })
      } else if (paths.length > 0) {
        // Reconcile: replace stale default-background paths with current ones & remove dupes
        const defaultByName = new Map<string, string>()
        for (const p of paths) defaultByName.set(basename(p), p)

        const seenNames = new Set<string>()
        const reconciled: string[] = []
        let changed = false
        for (const saved of appearance.bgImageList) {
          const name = basename(saved)
          if (seenNames.has(name)) { changed = true; continue } // drop duplicate
          seenNames.add(name)
          const current = defaultByName.get(name)
          if (current && saved !== current) {
            reconciled.push(current) // replace stale path
            changed = true
          } else {
            reconciled.push(saved)
          }
        }
        if (changed) {
          const updates: Partial<AppearanceSettings> = { bgImageList: reconciled }
          // Fix bgImagePath too if it pointed to a stale default path
          if (appearance.bgImagePath) {
            const selName = basename(appearance.bgImagePath)
            const current = defaultByName.get(selName)
            if (current && appearance.bgImagePath !== current) {
              updates.bgImagePath = current
            }
          }
          update(updates)
        }
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
  }, [allImages])

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
                    <Check size={10} className="text-[var(--color-text-primary)]" />
                  </div>
                )}
                {/* Delete button (red X) — top-right */}
                <button
                  onClick={(e) => { e.stopPropagation(); removeFromList(path) }}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--color-scrim-60)] hover:bg-red-600 rounded-full p-0.5"
                  title={t('settings.removeFromList')}
                >
                  <X size={10} className="text-red-400 hover:text-[var(--color-text-primary)]" />
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
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-[var(--color-text-primary)] transition-transform ${
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
// Each snippet has a unique `id` used as a marker comment in the CSS so we can detect & toggle it.

interface CSSSnippet { id: string; name: string; nameKey: string; css: string }
interface CSSSnippetCategory { category: string; categoryKey: string; snippets: CSSSnippet[] }

/** Wrap snippet CSS with marker comments so it can be identified and toggled */
const wrapSnippet = (id: string, css: string): string => `/* [snippet:${id}] */\n${css}\n/* [/snippet:${id}] */`

/** Check if a snippet is currently present in the CSS text */
const isSnippetActive = (css: string, id: string): boolean => css.includes(`[snippet:${id}]`)

/** Remove a snippet (including markers) from the CSS text */
const removeSnippet = (css: string, id: string): string => {
  const regex = new RegExp(`\\s*/\\* \\[snippet:${id}\\] \\*/[\\s\\S]*?/\\* \\[/snippet:${id}\\] \\*/\\s*`, 'g')
  return css.replace(regex, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const CSS_SNIPPETS: CSSSnippetCategory[] = [
  {
    category: 'Sidebar',
    categoryKey: 'settings.cssCatSidebar',
    snippets: [
      {
        id: 'rounded-sidebar',
        name: 'Rounded sidebar items',
        nameKey: 'settings.cssRoundedSidebarItems',
        css: `/* Rounded sidebar nav buttons */
aside button {
  border-radius: 12px;
}`
      },
      {
        id: 'colored-active',
        name: 'Colored active indicator',
        nameKey: 'settings.cssColoredActive',
        css: `/* Glowing active sidebar item */
aside button[class*="bg-"] {
  box-shadow: inset 3px 0 0 var(--color-accent);
}`
      },
      {
        id: 'wider-sidebar',
        name: 'Wider sidebar',
        nameKey: 'settings.cssWiderSidebar',
        css: `/* Override sidebar width */
:root {
  --sidebar-width: 260px;
}`
      },
      {
        id: 'sidebar-hover-glow',
        name: 'Hover glow on sidebar',
        nameKey: 'settings.cssSidebarHoverGlow',
        css: `/* Accent glow on sidebar item hover */
aside button:hover {
  background: var(--color-accent-subtle) !important;
  box-shadow: 0 0 12px var(--color-accent-25);
}`
      },
      {
        id: 'sidebar-compact',
        name: 'Compact sidebar',
        nameKey: 'settings.cssSidebarCompact',
        css: `/* Tighter sidebar spacing */
aside button {
  padding-top: 4px !important;
  padding-bottom: 4px !important;
  font-size: 12px;
}`
      },
      {
        id: 'sidebar-separator',
        name: 'Sidebar item separators',
        nameKey: 'settings.cssSidebarSeparators',
        css: `/* Subtle divider between sidebar items */
aside button {
  border-bottom: 1px solid var(--color-border) !important;
}`
      }
    ]
  },
  {
    category: 'Cards & Surfaces',
    categoryKey: 'settings.cssCatCards',
    snippets: [
      {
        id: 'rounded-cards',
        name: 'Rounded cards',
        nameKey: 'settings.cssRoundedCards',
        css: `/* Rounded card corners */
.rounded-lg, .rounded-xl {
  border-radius: 16px !important;
}`
      },
      {
        id: 'glow-hover',
        name: 'Glow on hover',
        nameKey: 'settings.cssGlowHover',
        css: `/* Accent glow on card hover */
.rounded-lg:hover, .rounded-xl:hover {
  box-shadow: 0 0 20px var(--color-accent-25);
}`
      },
      {
        id: 'no-borders',
        name: 'Remove all borders',
        nameKey: 'settings.cssNoBorders',
        css: `/* Borderless look */
* {
  border-color: transparent !important;
}`
      },
      {
        id: 'card-lift-hover',
        name: 'Card lift on hover',
        nameKey: 'settings.cssCardLift',
        css: `/* Cards lift up on hover */
.rounded-lg:hover, .rounded-xl:hover {
  transform: translateY(-2px);
  transition: transform 0.15s ease;
}`
      },
      {
        id: 'thicker-borders',
        name: 'Thicker borders',
        nameKey: 'settings.cssThickerBorders',
        css: `/* Heavier border lines */
.border, [class*="border-"] {
  border-width: 2px !important;
}`
      },
      {
        id: 'accent-borders',
        name: 'Accent-colored borders',
        nameKey: 'settings.cssAccentBorders',
        css: `/* Borders use accent color */
.border, [class*="border-"] {
  border-color: var(--color-accent-25) !important;
}`
      },
      {
        id: 'flat-cards',
        name: 'Flat cards (no shadows)',
        nameKey: 'settings.cssFlatCards',
        css: `/* Remove all box shadows */
* {
  box-shadow: none !important;
}`
      }
    ]
  },
  {
    category: 'Typography',
    categoryKey: 'settings.cssCatTypography',
    snippets: [
      {
        id: 'monospace-font',
        name: 'Monospace everywhere',
        nameKey: 'settings.cssMonospace',
        css: `/* Monospace font */
* {
  font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace !important;
}`
      },
      {
        id: 'larger-text',
        name: 'Larger text',
        nameKey: 'settings.cssLargerText',
        css: `/* Bump up base font size */
:root {
  font-size: 18px;
}`
      },
      {
        id: 'smaller-text',
        name: 'Smaller text',
        nameKey: 'settings.cssSmallerText',
        css: `/* Compact base font size */
:root {
  font-size: 13px;
}`
      },
      {
        id: 'serif-font',
        name: 'Serif font',
        nameKey: 'settings.cssSerifFont',
        css: `/* Serif/editorial look */
* {
  font-family: 'Georgia', 'Times New Roman', serif !important;
}`
      },
      {
        id: 'uppercase-headings',
        name: 'Uppercase headings',
        nameKey: 'settings.cssUppercaseHeadings',
        css: `/* All headings uppercase */
h1, h2, h3, h4, h5, h6 {
  text-transform: uppercase !important;
  letter-spacing: 0.05em;
}`
      },
      {
        id: 'text-glow',
        name: 'Text glow effect',
        nameKey: 'settings.cssTextGlow',
        css: `/* Subtle glow on primary text */
[class*="text-primary"], h1, h2, h3 {
  text-shadow: 0 0 8px var(--color-accent-25);
}`
      },
      {
        id: 'tight-line-height',
        name: 'Tight line spacing',
        nameKey: 'settings.cssTightLineHeight',
        css: `/* Compact line height */
* {
  line-height: 1.3 !important;
}`
      }
    ]
  },
  {
    category: 'Backgrounds & Effects',
    categoryKey: 'settings.cssCatEffects',
    snippets: [
      {
        id: 'frosted-glass',
        name: 'Frosted glass panels',
        nameKey: 'settings.cssFrostedGlass',
        css: `/* Extra frosted glass effect */
[class*="bg-black/"], [class*="bg-white/"] {
  backdrop-filter: blur(20px) saturate(1.5);
}`
      },
      {
        id: 'scanlines',
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
        id: 'hide-bg-image',
        name: 'Hide background image',
        nameKey: 'settings.cssHideBg',
        css: `/* Remove background image */
[style*="background-image"] {
  background-image: none !important;
}`
      },
      {
        id: 'vignette',
        name: 'Vignette overlay',
        nameKey: 'settings.cssVignette',
        css: `/* Dark vignette edges */
#root::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9998;
  background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%);
}`
      },
      {
        id: 'noise-texture',
        name: 'Noise texture',
        nameKey: 'settings.cssNoiseTexture',
        css: `/* Subtle film-grain noise */
#root::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}`
      },
      {
        id: 'extra-dim-overlay',
        name: 'Extra dim overlay',
        nameKey: 'settings.cssExtraDim',
        css: `/* Darken the whole UI for OLED vibes */
#root {
  filter: brightness(0.85);
}`
      },
      {
        id: 'high-contrast',
        name: 'High contrast',
        nameKey: 'settings.cssHighContrast',
        css: `/* Increase contrast */
#root {
  filter: contrast(1.2);
}`
      },
      {
        id: 'saturate-boost',
        name: 'Boost saturation',
        nameKey: 'settings.cssSaturateBoost',
        css: `/* More vivid colors */
#root {
  filter: saturate(1.4);
}`
      },
      {
        id: 'desaturate',
        name: 'Desaturate UI',
        nameKey: 'settings.cssDesaturate',
        css: `/* Muted grayscale look */
#root {
  filter: saturate(0.3);
}`
      }
    ]
  },
  {
    category: 'Scrollbar',
    categoryKey: 'settings.cssCatScrollbar',
    snippets: [
      {
        id: 'thin-scrollbar',
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
        id: 'hide-scrollbars',
        name: 'Hide scrollbars',
        nameKey: 'settings.cssHideScrollbar',
        css: `/* Hide all scrollbars */
::-webkit-scrollbar {
  display: none;
}`
      },
      {
        id: 'rounded-scrollbar',
        name: 'Rounded fat scrollbar',
        nameKey: 'settings.cssRoundedScrollbar',
        css: `/* Chunky rounded scrollbar */
::-webkit-scrollbar {
  width: 12px;
}
::-webkit-scrollbar-track {
  background: var(--color-surface);
  border-radius: 6px;
}
::-webkit-scrollbar-thumb {
  background: var(--color-accent-25);
  border-radius: 6px;
  border: 2px solid var(--color-surface);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--color-accent);
}`
      }
    ]
  },
  {
    category: 'Animations',
    categoryKey: 'settings.cssCatAnimations',
    snippets: [
      {
        id: 'no-transitions',
        name: 'Disable all transitions',
        nameKey: 'settings.cssNoTransitions',
        css: `/* Instant UI — no animations */
*, *::before, *::after {
  transition-duration: 0s !important;
  animation-duration: 0s !important;
}`
      },
      {
        id: 'smooth-fade',
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
      },
      {
        id: 'slow-transitions',
        name: 'Slow transitions',
        nameKey: 'settings.cssSlowTransitions',
        css: `/* Slower, smoother transitions */
*, *::before, *::after {
  transition-duration: 0.4s !important;
}`
      },
      {
        id: 'scale-hover',
        name: 'Scale on hover',
        nameKey: 'settings.cssScaleHover',
        css: `/* Subtle scale-up on interactive elements */
button:hover, a:hover, [role="button"]:hover {
  transform: scale(1.03);
  transition: transform 0.15s ease;
}`
      }
    ]
  },
  {
    category: 'Layout',
    categoryKey: 'settings.cssCatLayout',
    snippets: [
      {
        id: 'rounded-everything',
        name: 'Round everything',
        nameKey: 'settings.cssRoundEverything',
        css: `/* Rounded corners on all elements */
*, *::before, *::after {
  border-radius: 12px !important;
}`
      },
      {
        id: 'square-everything',
        name: 'Square everything',
        nameKey: 'settings.cssSquareEverything',
        css: `/* Remove all rounded corners */
*, *::before, *::after {
  border-radius: 0 !important;
}`
      },
      {
        id: 'compact-padding',
        name: 'Compact padding',
        nameKey: 'settings.cssCompactPadding',
        css: `/* Reduce padding globally */
main * {
  padding-left: max(calc(var(--tw-pl, 0px) * 0.6), 0px);
  padding-right: max(calc(var(--tw-pr, 0px) * 0.6), 0px);
}`
      },
      {
        id: 'hide-statusbar',
        name: 'Hide status bar',
        nameKey: 'settings.cssHideStatusbar',
        css: `/* Hide the bottom status bar */
footer, [class*="statusbar"], [class*="StatusBar"] {
  display: none !important;
}`
      },
      {
        id: 'hide-titlebar',
        name: 'Hide title bar',
        nameKey: 'settings.cssHideTitlebar',
        css: `/* Hide the top title bar (use with caution) */
header, [class*="titlebar"], [class*="TitleBar"] {
  display: none !important;
}
/* Restore drag region */
#root { -webkit-app-region: drag; }
#root button, #root a, #root input, #root textarea { -webkit-app-region: no-drag; }`
      },
      {
        id: 'centered-content',
        name: 'Centered narrow content',
        nameKey: 'settings.cssCenteredContent',
        css: `/* Constrain main content width */
main > div {
  max-width: 960px;
  margin-left: auto;
  margin-right: auto;
}`
      }
    ]
  },
  {
    category: 'Buttons & Inputs',
    categoryKey: 'settings.cssCatButtons',
    snippets: [
      {
        id: 'pill-buttons',
        name: 'Pill-shaped buttons',
        nameKey: 'settings.cssPillButtons',
        css: `/* Fully rounded pill buttons */
button {
  border-radius: 999px !important;
}`
      },
      {
        id: 'button-outlines',
        name: 'Outlined buttons',
        nameKey: 'settings.cssOutlinedButtons',
        css: `/* Outline style buttons */
button {
  background: transparent !important;
  border: 1px solid var(--color-accent) !important;
  color: var(--color-accent) !important;
}
button:hover {
  background: var(--color-accent-subtle) !important;
}`
      },
      {
        id: 'input-accent-focus',
        name: 'Accent focus ring',
        nameKey: 'settings.cssAccentFocus',
        css: `/* Accent-colored focus ring on inputs */
input:focus, textarea:focus, select:focus {
  outline: 2px solid var(--color-accent) !important;
  outline-offset: 1px;
  border-color: var(--color-accent) !important;
}`
      },
      {
        id: 'large-buttons',
        name: 'Larger buttons',
        nameKey: 'settings.cssLargeButtons',
        css: `/* Bigger click targets */
button {
  min-height: 40px;
  padding-left: 16px !important;
  padding-right: 16px !important;
  font-size: 14px !important;
}`
      }
    ]
  },
  {
    category: 'Colors & Themes',
    categoryKey: 'settings.cssCatColors',
    snippets: [
      {
        id: 'invert-ui',
        name: 'Invert colors',
        nameKey: 'settings.cssInvertColors',
        css: `/* Invert the entire UI (light mode hack) */
#root {
  filter: invert(1) hue-rotate(180deg);
}
#root img, #root video {
  filter: invert(1) hue-rotate(180deg);
}`
      },
      {
        id: 'sepia-tint',
        name: 'Sepia tint',
        nameKey: 'settings.cssSepiaTint',
        css: `/* Warm sepia tone */
#root {
  filter: sepia(0.25);
}`
      },
      {
        id: 'hue-shift',
        name: 'Hue shift (+90°)',
        nameKey: 'settings.cssHueShift',
        css: `/* Rotate all colors 90 degrees */
#root {
  filter: hue-rotate(90deg);
}`
      },
      {
        id: 'accent-selection',
        name: 'Accent text selection',
        nameKey: 'settings.cssAccentSelection',
        css: `/* Custom text selection color */
::selection {
  background: var(--color-accent) !important;
  color: white !important;
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

  const toggleSnippet = useCallback((snippet: CSSSnippet): void => {
    if (isSnippetActive(localCSS, snippet.id)) {
      const newCSS = removeSnippet(localCSS, snippet.id)
      setLocalCSS(newCSS)
      update({ customCSS: newCSS })
    } else {
      const wrapped = wrapSnippet(snippet.id, snippet.css)
      const newCSS = localCSS ? `${localCSS}\n\n${wrapped}` : wrapped
      setLocalCSS(newCSS)
      update({ customCSS: newCSS })
    }
  }, [localCSS, update])

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
                theme={useThemeStore.getState().resolvedMode === 'light' ? 'vs' : 'vs-dark'}
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
          <div className="flex-1 overflow-y-auto border border-[var(--color-border)] bg-[var(--color-scrim-20)]">
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
                    {cat.snippets.map((snippet) => {
                      const active = isSnippetActive(localCSS, snippet.id)
                      return (
                        <button
                          key={snippet.id}
                          onClick={() => toggleSnippet(snippet)}
                          className={`flex items-center gap-2 px-4 py-2 text-left text-xs transition-colors border-b border-[var(--color-border)]/50 ${
                            active
                              ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                          }`}
                        >
                          {active ? <ToggleRight size={14} className="shrink-0 text-[var(--color-accent)]" /> : <ToggleLeft size={14} className="shrink-0 text-[var(--color-text-muted)]" />}
                          <span className="flex-1">{t(snippet.nameKey)}</span>
                          {active && <Check size={12} className="text-[var(--color-accent)] shrink-0" />}
                        </button>
                      )
                    })}
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
