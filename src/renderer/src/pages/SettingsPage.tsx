import { useState, useEffect, useCallback } from 'react'
import { FolderOpen, Globe, Check, AlertCircle, Package, Download, Upload, Palette, RotateCcw, Monitor, Type, Layers, Maximize2, PanelLeft, Eye, Image, X, Plus, Shuffle } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { useThemeStore, ACCENT_PRESETS, BG_STYLES } from '../stores/useThemeStore'
import type { AppearanceSettings } from '../../../shared/types'

type SettingsTab = 'general' | 'appearance'

export function SettingsPage(): React.JSX.Element {
  const config = useAppStore((s) => s.config)
  const [tab, setTab] = useState<SettingsTab>('general')

  return (
    <div className="flex flex-col h-full rounded-lg border border-[var(--color-border)] overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--color-border)]">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Settings</h1>
        <div className="flex gap-2 ml-4">
          {(['general', 'appearance'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs font-medium transition-colors ${
                tab === t
                  ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-transparent'
              }`}
            >
              {t === 'general' ? 'General' : 'Appearance'}
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

// ── General Settings Tab ──

function GeneralSettings({ config }: { config: ReturnType<typeof useAppStore.getState>['config'] }): React.JSX.Element {
  const [backendUrl, setBackendUrl] = useState(config?.backendUrl || '')
  const [backendHealthy, setBackendHealthy] = useState<boolean | null>(null)
  const [installDir, setInstallDir] = useState(config?.gamePaths?.installDir || '')
  const [userDir, setUserDir] = useState(config?.gamePaths?.userDir || '')
  const [saved, setSaved] = useState(false)

  const [repos, setRepos] = useState<Array<{ name: string; url: string; priority: number }>>([])
  const [reposSaved, setReposSaved] = useState(false)
  const [modpackName, setModpackName] = useState('')
  const [modpackStatus, setModpackStatus] = useState<string | null>(null)

  useEffect(() => {
    if (config) {
      setBackendUrl(config.backendUrl)
      setInstallDir(config.gamePaths?.installDir ?? '')
      setUserDir(config.gamePaths?.userDir ?? '')
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
    if (backendUrl !== config?.backendUrl) {
      await window.api.setBackendUrl(backendUrl)
    }
    if (installDir && userDir) {
      await window.api.setCustomPaths(installDir, userDir)
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
        {/* Game Paths */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <FolderOpen size={16} />
            Game Paths
          </h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Install Directory</label>
                <input
                  type="text"
                  value={installDir}
                  onChange={(e) => setInstallDir(e.target.value)}
                  placeholder="C:\Program Files (x86)\Steam\steamapps\common\BeamNG.drive"
                  className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">User Data Directory</label>
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
                Auto-detect paths
              </button>
            </div>
          </section>

          {/* Backend */}
          <section>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
              <Globe size={16} />
              Backend Server
            </h2>
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
                Test
              </button>
            </div>
            {backendHealthy !== null && (
              <p
                className={`mt-2 text-xs flex items-center gap-1 ${backendHealthy ? 'text-green-400' : 'text-red-400'}`}
              >
                {backendHealthy ? <Check size={12} /> : <AlertCircle size={12} />}
                {backendHealthy ? 'Backend is reachable' : 'Backend is unreachable'}
              </p>
            )}
          </section>

          {/* Save */}
          <button
            onClick={handleSave}
            className="self-start px-6 py-2 rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium transition-colors"
          >
            {saved ? 'Saved!' : 'Save Settings'}
          </button>

          {/* Registry Settings */}
          <section>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
              <Package size={16} />
              Mod Registry
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
                    placeholder="Name"
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
                    placeholder="GitHub API URL"
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
                  + Add repository
                </button>
                <button
                  onClick={async () => {
                    await window.api.registrySetRepositories(repos)
                    setReposSaved(true)
                    setTimeout(() => setReposSaved(false), 2000)
                  }}
                  className="text-xs text-[var(--color-accent)] hover:underline"
                >
                  {reposSaved ? '✓ Saved' : 'Save repositories'}
                </button>
              </div>
            </div>
          </section>

          {/* Modpack Export / Import */}
          <section>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
              <Download size={16} />
              Modpack Export / Import
            </h2>
            <div className="flex flex-col gap-3">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={modpackName}
                  onChange={(e) => setModpackName(e.target.value)}
                  placeholder="Modpack name"
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
                    setModpackStatus('Exported!')
                    setTimeout(() => setModpackStatus(null), 2000)
                  }}
                  className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1"
                >
                  <Upload size={14} /> Export
                </button>
              </div>
              <div className="flex gap-2 items-center">
                <label className="px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1 cursor-pointer">
                  <Download size={14} /> Import Modpack
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
                        setModpackStatus(`Error: ${result.error}`)
                      } else if (result.missing.length > 0) {
                        setModpackStatus(`Found ${result.identifiers.length} mods, ${result.missing.length} unavailable`)
                      } else {
                        setModpackStatus(`Ready to install ${result.identifiers.length} mods`)
                      }
                      if (result.identifiers.length > 0) {
                        await window.api.registryInstall(result.identifiers)
                        setModpackStatus(`Installed ${result.identifiers.length} mods from modpack`)
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

  const inputClass =
    'w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]'

  return (
    <div className="max-w-2xl">
      <div className="flex flex-col gap-8">
        {/* Accent Color */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Palette size={16} />
            Accent Color
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
            UI Scale
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
            Scales the entire interface. 100% is the default (110% system zoom).
          </p>
        </section>

        {/* Font Size */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <Type size={16} />
            Font Size
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
            Background Style
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
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Gradient Color 1</label>
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
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Gradient Color 2</label>
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
            Surface &amp; Borders
          </h2>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Surface Opacity</label>
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
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Border Opacity</label>
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
            Effects
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
              <span className="text-sm text-[var(--color-text-primary)]">Blur Effects</span>
              <p className="text-xs text-[var(--color-text-muted)]">Glassmorphism blur on panels and overlays</p>
            </div>
          </label>
        </section>

        {/* Sidebar Width */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
            <PanelLeft size={16} />
            Sidebar Width
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

        {/* Reset */}
        <section>
          <button
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <RotateCcw size={14} />
            Reset to Defaults
          </button>
          <p className="text-xs text-[var(--color-text-muted)] mt-2">
            Restores all appearance settings to factory defaults.
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
    setThumbs((prev) => {
      const next = { ...prev }
      delete next[path]
      return next
    })
  }, [appearance.bgImageList, appearance.bgImagePath, update])

  const selectImage = useCallback((path: string) => {
    if (appearance.bgImagePath === path) {
      update({ bgImagePath: null })
    } else {
      update({ bgImagePath: path })
    }
  }, [appearance.bgImagePath, update])

  const isDefault = (path: string): boolean => defaultPaths.includes(path)

  return (
    <section>
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2" style={{ marginBottom: 20 }}>
        <Image size={16} />
        Background Image
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
                {!isDefault(path) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFromList(path) }}
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 hover:bg-red-600 rounded-full p-0.5"
                    title="Remove from list"
                  >
                    <X size={10} className="text-red-400 hover:text-white" />
                  </button>
                )}
              </div>
            )
          })}

          {/* Add image button */}
          <button
            onClick={addImage}
            className="aspect-[16/9] border-2 border-dashed border-[var(--color-border)] hover:border-[var(--color-accent)] flex flex-col items-center justify-center gap-1 transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
          >
            <Plus size={16} />
            <span className="text-[10px]">Add Image</span>
          </button>
        </div>

        {/* Cycle on launch toggle */}
        <div className="flex items-center justify-between p-3 bg-[var(--color-surface)] border border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <Shuffle size={14} className="text-[var(--color-accent)]" />
            <span className="text-xs text-[var(--color-text-primary)]">Random background on launch</span>
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
            Active: {appearance.bgImagePath.split(/[\\/]/).pop()}
          </p>
        )}

        {/* Opacity & Blur controls */}
        {appearance.bgImagePath && (
          <>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Image Opacity</label>
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
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Image Blur</label>
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
