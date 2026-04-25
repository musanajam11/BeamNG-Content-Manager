
import { useState, useEffect, useRef } from 'react'
import { Loader2, CheckCircle, AlertCircle, FolderOpen, Globe, ArrowRight, ArrowLeft, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../stores/useAppStore'
import { useThemeStore } from '../stores/useThemeStore'
import type { AppPage } from '../../../shared/types'

type WizardStep = 'welcome' | 'paths' | 'backend' | 'beammp' | 'done'

const SERVER_MANAGER_ONLY_HIDDEN: AppPage[] = [
  'home',
  'servers',
  'friends',
  'vehicles',
  'maps',
  'mods',
  'career',
  'launcher',
  'controls',
  'live-gps',
  'livery-editor',
  'voice-chat',
  'lua-console',
  'world-edit-sync',
]

const TIPS = [
  'Manage all your BeamNG mods, maps, and vehicles in one place.',
  'Browse and join multiplayer servers with a single click.',
  'Customize your UI with themes, backgrounds, and accent colors.',
  'Auto-detect your BeamNG.drive installation — no manual setup needed.',
  'Track your friends and see what servers they\'re playing on.',
  'Create and manage your own BeamMP server directly from the app.',
  'Organize your mod load order for the best experience.',
  'Explore career mode progress and saved games.',
]

export function SetupWizard(): React.JSX.Element {
  const { t } = useTranslation()
  const [step, setStep] = useState<WizardStep>('welcome')
  const [mode, setMode] = useState<'full' | 'server-manager-only'>('full')
  const [agreedToLicense, setAgreedToLicense] = useState(false)
  const [installDir, setInstallDir] = useState('')
  const [userDir, setUserDir] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [pathError, setPathError] = useState<string | null>(null)
  const [backendUrl, setBackendUrl] = useState('https://backend.beammp.com')
  const [backendType, setBackendType] = useState<'official' | 'custom'>('official')
  const [backendHealthy, setBackendHealthy] = useState<boolean | null>(null)
  const [beammpInstalled, setBeammpInstalled] = useState<boolean | null>(null)
  const [beammpInstalling, setBeammpInstalling] = useState(false)
  const [beammpError, setBeammpError] = useState<string | null>(null)
  const [bgDataUrl, setBgDataUrl] = useState<string | null>(null)
  const [tipIndex, setTipIndex] = useState(0)
  const [tipVisible, setTipVisible] = useState(true)
  const tipTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load a random background image via IPC on mount
  useEffect(() => {
    window.api.getDefaultBackgrounds().then((paths) => {
      if (paths.length > 0) {
        const pick = paths[Math.floor(Math.random() * paths.length)]
        window.api.loadBackgroundImage(pick).then((dataUrl) => {
          if (dataUrl) setBgDataUrl(dataUrl)
        })
      }
    })
  }, [])

  // Rotate tips every 5 seconds with fade
  useEffect(() => {
    tipTimer.current = setInterval(() => {
      setTipVisible(false)
      setTimeout(() => {
        setTipIndex((prev) => (prev + 1) % TIPS.length)
        setTipVisible(true)
      }, 400)
    }, 5000)
    return () => { if (tipTimer.current) clearInterval(tipTimer.current) }
  }, [])

  const handleAutoDetect = async (): Promise<void> => {
    setDetecting(true)
    setPathError(null)
    try {
      const paths = await window.api.discoverPaths()
      if (paths) {
        setInstallDir(paths.installDir ?? '')
        setUserDir(paths.userDir ?? '')
      } else {
        setPathError(t('setup.autoDetectFailed'))
      }
    } catch {
      setPathError(t('setup.autoDetectError'))
    }
    setDetecting(false)
  }

  const handleValidatePaths = async (): Promise<void> => {
    if (!installDir || !userDir) {
      setPathError(t('setup.pathsRequired'))
      return
    }
    try {
      await window.api.setCustomPaths(installDir, userDir)
      setPathError(null)
      setStep('backend')
    } catch (err) {
      setPathError((err as Error).message)
    }
  }

  const handleTestBackend = async (): Promise<void> => {
    const url = backendType === 'official' ? 'https://backend.beammp.com' : backendUrl
    await window.api.setBackendUrl(url)
    try {
      const healthy = await window.api.checkBackendHealth()
      setBackendHealthy(healthy)
    } catch {
      setBackendHealthy(false)
    }
  }

  const goBack = (): void => {
    if (step === 'paths') setStep('welcome')
    else if (step === 'backend') setStep('paths')
    else if (step === 'beammp') setStep('backend')
    else if (step === 'done') setStep(mode === 'server-manager-only' ? 'welcome' : 'beammp')
  }

  const handleFinish = async (): Promise<void> => {
    const url = backendType === 'official' ? 'https://backend.beammp.com' : backendUrl
    await window.api.setBackendUrl(url)
    if (mode === 'server-manager-only') {
      await useThemeStore.getState().update({
        sidebarHidden: [...SERVER_MANAGER_ONLY_HIDDEN],
      })
      useAppStore.getState().setPage('server-admin')
    }
    await useAppStore.getState().markSetupComplete()
    await useAppStore.getState().loadConfig()
  }

  return (
    <div className="flex flex-col h-screen relative overflow-hidden">
      {/* Blurred random background */}
      <div
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat pointer-events-none transition-opacity duration-1000"
        style={{
          backgroundImage: bgDataUrl ? `url(${bgDataUrl})` : 'none',
          filter: 'blur(18px) brightness(0.6) saturate(1.2)',
          transform: 'scale(1.08)',
          opacity: bgDataUrl ? 1 : 0,
        }}
      />
      {/* Overlay for readability */}
      <div className="absolute inset-0 z-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(20,20,24,0.55) 0%, rgba(20,20,24,0.75) 100%)' }} />

      {/* Minimal titlebar for drag */}
      <div className="titlebar-drag h-9 bg-transparent relative z-10">
        <div className="h-full" />
        <div className="absolute right-0 top-0 flex titlebar-no-drag">
          <button
            onClick={() => window.api.minimizeWindow()}
            className="w-11 h-9 flex items-center justify-center hover:bg-[var(--color-surface-active)] text-[var(--color-text-secondary)] text-xs"
          >
            ─
          </button>
          <button
            onClick={() => window.api.closeWindow()}
            className="w-11 h-9 flex items-center justify-center hover:bg-red-600 text-[var(--color-text-secondary)] text-xs"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-12 pb-8 relative z-10">
        <div className="w-full max-w-lg">

          {/* Step: Welcome */}
          {step === 'welcome' && (
            <div className="flex flex-col items-center gap-6 text-center animate-fadein">
              <h1 className="text-4xl font-bold text-[var(--color-text-primary)] drop-shadow-lg">
                {t('setup.welcome')}
              </h1>
              <p className="text-[var(--color-text-secondary)] text-sm max-w-sm">
                {t('setup.welcomeDesc')}
              </p>

              <div className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-scrim-30)] p-4 text-left backdrop-blur-sm space-y-3">
                <div className="text-xs font-semibold text-[var(--color-text-primary)]">How do you want to use CM?</div>
                <label className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                  <input
                    type="radio"
                    name="setup-mode"
                    checked={mode === 'full'}
                    onChange={() => setMode('full')}
                    className="mt-0.5 accent-[var(--accent-primary)]"
                  />
                  <span>
                    <span className="text-[var(--color-text-primary)] font-medium">Full experience</span>
                    {' — '}setup game paths, backend, and BeamMP integration.
                  </span>
                </label>
                <label className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                  <input
                    type="radio"
                    name="setup-mode"
                    checked={mode === 'server-manager-only'}
                    onChange={() => setMode('server-manager-only')}
                    className="mt-0.5 accent-[var(--accent-primary)]"
                  />
                  <span>
                    <span className="text-[var(--color-text-primary)] font-medium">Server Manager only</span>
                    {' — '}only the Server Manager page will stay visible in the sidebar.
                  </span>
                </label>
              </div>

              <label className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-scrim-30)] p-3 backdrop-blur-sm text-left flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedToLicense}
                  onChange={(e) => setAgreedToLicense(e.target.checked)}
                  className="mt-0.5 accent-[var(--accent-primary)]"
                />
                <span className="text-xs text-[var(--color-text-secondary)]">
                  I'm chill (not aggro)
                </span>
              </label>

              <button
                onClick={() => {
                  if (mode === 'server-manager-only') {
                    setStep('done')
                    return
                  }
                  setStep('paths')
                  void handleAutoDetect()
                }}
                disabled={!agreedToLicense}
                className="flex items-center gap-2 px-8 py-3 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[var(--color-text-primary)] font-semibold transition-colors shadow-lg mt-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('setup.getStarted')}
                <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* Step: Game Paths */}
          {step === 'paths' && (
            <div className="flex flex-col gap-6 animate-fadein">
              <div className="flex items-center gap-3">
                <FolderOpen size={20} className="text-[var(--accent-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)] drop-shadow">{t('setup.gamePaths')}</h2>
              </div>

              {detecting ? (
                <div className="flex items-center gap-3 text-[var(--color-text-secondary)] text-sm">
                  <Loader2 size={16} className="animate-spin" />
                  {t('setup.autoDetecting')}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                      {t('setup.installDir')}
                    </label>
                    <input
                      type="text"
                      value={installDir}
                      onChange={(e) => setInstallDir(e.target.value)}
                      placeholder="C:\Program Files (x86)\Steam\steamapps\common\BeamNG.drive"
                      className="w-full bg-[var(--color-scrim-30)] border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:border-[var(--accent-primary)] backdrop-blur-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                      {t('setup.userDataDir')}
                    </label>
                    <input
                      type="text"
                      value={userDir}
                      onChange={(e) => setUserDir(e.target.value)}
                      placeholder="C:\Users\...\AppData\Local\BeamNG.drive"
                      className="w-full bg-[var(--color-scrim-30)] border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:border-[var(--accent-primary)] backdrop-blur-sm"
                    />
                  </div>
                  <button
                    onClick={handleAutoDetect}
                    className="self-start text-xs text-[var(--accent-primary)] hover:underline"
                  >
                    {t('setup.redetect')}
                  </button>
                </div>
              )}

              {pathError && (
                <p className="text-red-400 text-xs flex items-center gap-1">
                  <AlertCircle size={12} />
                  {pathError}
                </p>
              )}

              <div className="flex items-center justify-between">
                <button
                  onClick={goBack}
                  className="flex items-center gap-1 px-4 py-2.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm transition-colors"
                >
                  <ArrowLeft size={16} />
                  {t('common.back')}
                </button>
                <button
                  onClick={handleValidatePaths}
                  disabled={detecting || !installDir || !userDir}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[var(--color-text-primary)] text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('common.continue')}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Step: Backend */}
          {step === 'backend' && (
            <div className="flex flex-col gap-6 animate-fadein">
              <div className="flex items-center gap-3">
                <Globe size={20} className="text-[var(--accent-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)] drop-shadow">
                  {t('setup.backendServer')}
                </h2>
              </div>

              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors bg-[var(--color-scrim-30)] border-[var(--color-border)] hover:border-[var(--accent-primary)] backdrop-blur-sm">
                  <input
                    type="radio"
                    name="backend"
                    checked={backendType === 'official'}
                    onChange={() => setBackendType('official')}
                    className="accent-[var(--accent-primary)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {t('setup.officialBackend')}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {t('setup.officialBackendDesc')}
                    </p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors bg-[var(--color-scrim-30)] border-[var(--color-border)] hover:border-[var(--accent-primary)] backdrop-blur-sm">
                  <input
                    type="radio"
                    name="backend"
                    checked={backendType === 'custom'}
                    onChange={() => setBackendType('custom')}
                    className="accent-[var(--accent-primary)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {t('setup.selfHosted')}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {t('setup.selfHostedDesc')}
                    </p>
                  </div>
                </label>
              </div>

              {backendType === 'custom' && (
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('setup.backendUrl')}</label>
                  <input
                    type="text"
                    value={backendUrl}
                    onChange={(e) => setBackendUrl(e.target.value)}
                    placeholder="https://beammp.yourserver.com"
                    className="w-full bg-[var(--color-scrim-30)] border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:border-[var(--accent-primary)] backdrop-blur-sm"
                  />
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={handleTestBackend}
                  className="px-4 py-2 rounded-lg bg-[var(--color-scrim-30)] border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] transition-colors backdrop-blur-sm"
                >
                  {t('setup.testConnection')}
                </button>
                {backendHealthy !== null && (
                  <span
                    className={`text-xs flex items-center gap-1 ${backendHealthy ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {backendHealthy ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                    {backendHealthy ? t('setup.connected') : t('setup.unreachable')}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={goBack}
                  className="flex items-center gap-1 px-4 py-2.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm transition-colors"
                >
                  <ArrowLeft size={16} />
                  {t('common.back')}
                </button>
                <button
                  onClick={async () => {
                    setStep('beammp')
                    const installed = await window.api.checkBeamMPInstalled()
                    setBeammpInstalled(installed)
                  }}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[var(--color-text-primary)] text-sm font-medium transition-colors"
                >
                  {t('common.continue')}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Step: BeamMP Install */}
          {step === 'beammp' && (
            <div className="flex flex-col gap-6 animate-fadein">
              <div className="flex items-center gap-3">
                <Download size={20} className="text-[var(--accent-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)] drop-shadow">
                  {t('setup.beammpInstall')}
                </h2>
              </div>

              {beammpInstalled === null ? (
                <div className="flex items-center gap-3 text-[var(--color-text-secondary)] text-sm">
                  <Loader2 size={16} className="animate-spin" />
                  {t('setup.beammpChecking')}
                </div>
              ) : beammpInstalled ? (
                <div className="flex items-center gap-2 text-green-400 text-sm">
                  <CheckCircle size={16} />
                  {t('setup.beammpAlreadyInstalled')}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {t('setup.beammpNotFound')}
                  </p>
                  <button
                    onClick={async () => {
                      setBeammpInstalling(true)
                      setBeammpError(null)
                      try {
                        const result = await window.api.installBeamMP()
                        if (result.success) {
                          setBeammpInstalled(true)
                        } else {
                          setBeammpError(result.error || t('setup.beammpInstallFailed'))
                        }
                      } catch (err) {
                        setBeammpError(String(err))
                      }
                      setBeammpInstalling(false)
                    }}
                    disabled={beammpInstalling}
                    className="self-start flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[var(--color-text-primary)] text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {beammpInstalling ? (
                      <><Loader2 size={16} className="animate-spin" /> {t('setup.beammpDownloading')}</>
                    ) : (
                      <><Download size={16} /> {t('setup.beammpDownloadInstall')}</>
                    )}
                  </button>
                  {beammpError && (
                    <p className="text-red-400 text-xs flex items-center gap-1">
                      <AlertCircle size={12} />
                      {beammpError}
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between">
                <button
                  onClick={goBack}
                  className="flex items-center gap-1 px-4 py-2.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-sm transition-colors"
                >
                  <ArrowLeft size={16} />
                  {t('common.back')}
                </button>
                <button
                  onClick={() => setStep('done')}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[var(--color-text-primary)] text-sm font-medium transition-colors"
                >
                  {t('common.continue')}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && (
            <div className="flex flex-col items-center gap-6 text-center animate-fadein">
              <CheckCircle size={48} className="text-green-400 drop-shadow-lg" />
              <h2 className="text-2xl font-bold text-[var(--color-text-primary)] drop-shadow">{t('setup.allSet')}</h2>
              <p className="text-[var(--color-text-secondary)] text-sm max-w-sm">
                {t('setup.allSetDesc')}
              </p>
              {mode === 'server-manager-only' && (
                <p className="text-xs text-[var(--color-text-muted)] max-w-sm">
                  Server Manager mode enabled. BeamMP server binaries will auto-download on demand when missing.
                </p>
              )}
              <div className="flex flex-col items-center gap-3">
                <button
                  onClick={handleFinish}
                  className="px-8 py-3 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[var(--color-text-primary)] font-semibold transition-colors shadow-lg"
                >
                  {t('setup.launchApp')}
                </button>
                <button
                  onClick={goBack}
                  className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  <ArrowLeft size={13} />
                  {t('common.back')}
                </button>
              </div>
            </div>
          )}

          {/* Step indicators */}
          <div className="flex items-center justify-center gap-2 mt-10">
            {(['welcome', 'paths', 'backend', 'beammp', 'done'] as WizardStep[]).map((s) => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  s === step ? 'bg-[var(--accent-primary)] scale-125' : 'bg-[var(--color-surface-active)]'
                }`}
              />
            ))}
          </div>

          {/* Rotating tips */}
          <div className="mt-6 min-h-[2rem] flex items-center justify-center">
            <p
              className="text-xs text-[var(--color-text-dim)] text-center italic transition-opacity duration-400"
              style={{ opacity: tipVisible ? 1 : 0 }}
            >
              💡 {TIPS[tipIndex]}
            </p>
          </div>
        </div>
      </div>


    </div>
  )
}
