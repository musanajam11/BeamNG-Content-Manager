import { useState } from 'react'
import { Loader2, CheckCircle, AlertCircle, FolderOpen, Globe, ArrowRight } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'

type WizardStep = 'welcome' | 'paths' | 'backend' | 'done'

export function SetupWizard(): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>('welcome')
  const [installDir, setInstallDir] = useState('')
  const [userDir, setUserDir] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [pathError, setPathError] = useState<string | null>(null)
  const [backendUrl, setBackendUrl] = useState('https://backend.beammp.com')
  const [backendType, setBackendType] = useState<'official' | 'custom'>('official')
  const [backendHealthy, setBackendHealthy] = useState<boolean | null>(null)

  const handleAutoDetect = async (): Promise<void> => {
    setDetecting(true)
    setPathError(null)
    try {
      const paths = await window.api.discoverPaths()
      if (paths) {
        setInstallDir(paths.installDir ?? '')
        setUserDir(paths.userDir ?? '')
      } else {
        setPathError('Could not auto-detect BeamNG.drive. Please enter paths manually.')
      }
    } catch {
      setPathError('Auto-detection failed. Please enter paths manually.')
    }
    setDetecting(false)
  }

  const handleValidatePaths = async (): Promise<void> => {
    if (!installDir || !userDir) {
      setPathError('Both paths are required.')
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

  const handleFinish = async (): Promise<void> => {
    const url = backendType === 'official' ? 'https://backend.beammp.com' : backendUrl
    await window.api.setBackendUrl(url)
    await useAppStore.getState().markSetupComplete()
    await useAppStore.getState().loadConfig()
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)]">
      {/* Minimal titlebar for drag */}
      <div className="titlebar h-9 bg-[var(--bg-primary)] border-b border-[var(--border-primary)]">
        <div className="drag h-full" />
        <div className="absolute right-0 top-0 flex no-drag">
          <button
            onClick={() => window.api.minimizeWindow()}
            className="w-11 h-9 flex items-center justify-center hover:bg-[var(--bg-hover)] text-[var(--text-muted)] text-xs"
          >
            ─
          </button>
          <button
            onClick={() => window.api.closeWindow()}
            className="w-11 h-9 flex items-center justify-center hover:bg-red-600 text-[var(--text-muted)] text-xs"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-lg">
          {/* Step: Welcome */}
          {step === 'welcome' && (
            <div className="flex flex-col items-center gap-6 text-center">
              <h1 className="text-3xl font-bold text-[var(--text-primary)]">
                Welcome to BeamMP Content Manager
              </h1>
              <p className="text-[var(--text-secondary)] text-sm max-w-sm">
                Let's set up your game paths and backend connection before you start playing.
              </p>
              <button
                onClick={() => {
                  setStep('paths')
                  handleAutoDetect()
                }}
                className="flex items-center gap-2 px-8 py-3 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white font-semibold transition-colors"
              >
                Get Started
                <ArrowRight size={18} />
              </button>
            </div>
          )}

          {/* Step: Game Paths */}
          {step === 'paths' && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <FolderOpen size={20} className="text-[var(--accent-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--text-primary)]">Game Paths</h2>
              </div>

              {detecting ? (
                <div className="flex items-center gap-3 text-[var(--text-secondary)] text-sm">
                  <Loader2 size={16} className="animate-spin" />
                  Auto-detecting BeamNG.drive installation...
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="text-xs text-[var(--text-muted)] mb-1 block">
                      Install Directory
                    </label>
                    <input
                      type="text"
                      value={installDir}
                      onChange={(e) => setInstallDir(e.target.value)}
                      placeholder="C:\Program Files (x86)\Steam\steamapps\common\BeamNG.drive"
                      className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text-muted)] mb-1 block">
                      User Data Directory
                    </label>
                    <input
                      type="text"
                      value={userDir}
                      onChange={(e) => setUserDir(e.target.value)}
                      placeholder="C:\Users\...\AppData\Local\BeamNG.drive"
                      className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                    />
                  </div>
                  <button
                    onClick={handleAutoDetect}
                    className="self-start text-xs text-[var(--accent-primary)] hover:underline"
                  >
                    Re-detect automatically
                  </button>
                </div>
              )}

              {pathError && (
                <p className="text-red-400 text-xs flex items-center gap-1">
                  <AlertCircle size={12} />
                  {pathError}
                </p>
              )}

              <button
                onClick={handleValidatePaths}
                disabled={detecting || !installDir || !userDir}
                className="self-end flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue
                <ArrowRight size={16} />
              </button>
            </div>
          )}

          {/* Step: Backend */}
          {step === 'backend' && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <Globe size={20} className="text-[var(--accent-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                  Backend Server
                </h2>
              </div>

              <div className="flex flex-col gap-3">
                <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors bg-[var(--bg-tertiary)] border-[var(--border-primary)] hover:border-[var(--accent-primary)]">
                  <input
                    type="radio"
                    name="backend"
                    checked={backendType === 'official'}
                    onChange={() => setBackendType('official')}
                    className="accent-[var(--accent-primary)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      Official BeamMP Backend
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Use the default BeamMP servers at backend.beammp.com
                    </p>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors bg-[var(--bg-tertiary)] border-[var(--border-primary)] hover:border-[var(--accent-primary)]">
                  <input
                    type="radio"
                    name="backend"
                    checked={backendType === 'custom'}
                    onChange={() => setBackendType('custom')}
                    className="accent-[var(--accent-primary)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      Self-Hosted Backend
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Connect to a custom BeamMP backend server
                    </p>
                  </div>
                </label>
              </div>

              {backendType === 'custom' && (
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1 block">Backend URL</label>
                  <input
                    type="text"
                    value={backendUrl}
                    onChange={(e) => setBackendUrl(e.target.value)}
                    placeholder="https://beammp.yourserver.com"
                    className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={handleTestBackend}
                  className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  Test Connection
                </button>
                {backendHealthy !== null && (
                  <span
                    className={`text-xs flex items-center gap-1 ${backendHealthy ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {backendHealthy ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                    {backendHealthy ? 'Connected' : 'Unreachable'}
                  </span>
                )}
              </div>

              <button
                onClick={() => {
                  setStep('done')
                }}
                className="self-end flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium transition-colors"
              >
                Continue
                <ArrowRight size={16} />
              </button>
            </div>
          )}

          {/* Step: Done */}
          {step === 'done' && (
            <div className="flex flex-col items-center gap-6 text-center">
              <CheckCircle size={48} className="text-green-400" />
              <h2 className="text-2xl font-bold text-[var(--text-primary)]">You&apos;re all set!</h2>
              <p className="text-[var(--text-secondary)] text-sm max-w-sm">
                Your BeamMP Content Manager is configured and ready to use.
              </p>
              <button
                onClick={handleFinish}
                className="px-8 py-3 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white font-semibold transition-colors"
              >
                Launch Content Manager
              </button>
            </div>
          )}

          {/* Step indicators */}
          <div className="flex items-center justify-center gap-2 mt-10">
            {(['welcome', 'paths', 'backend', 'done'] as WizardStep[]).map((s) => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full transition-colors ${
                  s === step ? 'bg-[var(--accent-primary)]' : 'bg-[var(--border-primary)]'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
