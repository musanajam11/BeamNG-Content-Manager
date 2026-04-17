import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Mic,
  MicOff,
  Volume2,
  Radio,
  Keyboard,
  Gauge,
  DoorOpen,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  Check,
  Globe,
  Play,
  Square,
  Send
} from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { useVoiceChatStore } from '../stores/useVoiceChatStore'
import type { VoiceChatSettings, VoiceChatMode } from '../../../shared/types'

export function VoiceChatPage(): React.JSX.Element {
  const { t } = useTranslation()
  const config = useAppStore((s) => s.config)
  const saveConfig = useAppStore((s) => s.saveConfig)
  const voiceSettings = config?.voiceChat
  const enabled = useVoiceChatStore((s) => s.enabled)
  const enable = useVoiceChatStore((s) => s.enable)
  const disable = useVoiceChatStore((s) => s.disable)
  const testTransmit = useVoiceChatStore((s) => s.testTransmit)
  const peersMap = useVoiceChatStore((s) => s.peers)

  const peers = useMemo(() => {
    const list: { playerId: number; playerName: string; speaking: boolean }[] = []
    for (const [, p] of peersMap) {
      list.push({ playerId: p.playerId, playerName: p.playerName, speaking: p.speaking })
    }
    return list
  }, [peersMap])

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [capturingKey, setCapturingKey] = useState(false)
  const [testingMic, setTestingMic] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [testStream, setTestStream] = useState<MediaStream | null>(null)
  const [testingSpeaker, setTestingSpeaker] = useState(false)
  const [speakerTestCtx, setSpeakerTestCtx] = useState<AudioContext | null>(null)

  // Load audio devices
  function refreshDevices(): void {
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => {
        setDevices(all.filter((d) => d.kind === 'audioinput'))
        setOutputDevices(all.filter((d) => d.kind === 'audiooutput'))
      })
      .catch(() => {})
  }

  useEffect(() => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => {
        setDevices(all.filter((d) => d.kind === 'audioinput'))
        setOutputDevices(all.filter((d) => d.kind === 'audiooutput'))
      })
      .catch(() => {})

    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
  }, [])

  const updateSetting = useCallback(
    async <K extends keyof VoiceChatSettings>(key: K, value: VoiceChatSettings[K]) => {
      if (!voiceSettings) return
      const updated = { ...voiceSettings, [key]: value }
      await saveConfig({ voiceChat: updated })
      useVoiceChatStore.getState().updateSettings({ [key]: value })
    },
    [voiceSettings, saveConfig]
  )

  // PTT key capture
  useEffect(() => {
    if (!capturingKey) return
    const handler = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      updateSetting('pttKey', e.code)
      setCapturingKey(false)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [capturingKey, updateSetting])

  // Mic test
  useEffect(() => {
    if (!testingMic) {
      if (testStream) {
        testStream.getTracks().forEach((t) => t.stop())
        // eslint-disable-next-line react-hooks/set-state-in-effect -- cleanup stream
        setTestStream(null)
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset level
      setMicLevel(0)
      return
    }

    let cancelled = false
    let animFrameId: number
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: voiceSettings?.inputDeviceId
            ? { deviceId: { exact: voiceSettings.inputDeviceId } }
            : true
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        setTestStream(stream)
        const ctx = new AudioContext()
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        source.connect(analyser)
        const data = new Float32Array(analyser.fftSize)

        const tick = (): void => {
          if (cancelled) return
          analyser.getFloatTimeDomainData(data)
          // RMS (root mean square) — gives a stable, responsive level
          let sum = 0
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
          const rms = Math.sqrt(sum / data.length)
          // Scale: normal speech ≈ 0.02–0.15 RMS → map to 0–1 range
          setMicLevel(Math.min(1, rms * 8))
          animFrameId = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        setTestingMic(false)
      }
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(animFrameId)
    }
  }, [testingMic, voiceSettings?.inputDeviceId])

  // Speaker test — plays a short sine sweep through the selected output device
  useEffect(() => {
    if (!testingSpeaker) {
      if (speakerTestCtx) {
        speakerTestCtx.close().catch(() => {})
        // eslint-disable-next-line react-hooks/set-state-in-effect -- cleanup ctx
        setSpeakerTestCtx(null)
      }
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const ctx = new AudioContext()
        // Route to selected output device
        if (
          voiceSettings?.outputDeviceId &&
          'setSinkId' in ctx &&
          typeof (ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId === 'function'
        ) {
          await (ctx as AudioContext & { setSinkId: (id: string) => Promise<void> }).setSinkId(voiceSettings.outputDeviceId)
        }
        if (cancelled) {
          ctx.close()
          return
        }
        setSpeakerTestCtx(ctx)

        // Play a 3-tone ascending beep sequence
        const tones = [440, 554, 659]
        const duration = 0.25
        const gap = 0.1
        for (let i = 0; i < tones.length; i++) {
          if (cancelled) break
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.value = tones[i]
          gain.gain.value = 0.3
          gain.gain.setTargetAtTime(0, ctx.currentTime + duration - 0.05, 0.02)
          osc.connect(gain)
          gain.connect(ctx.destination)
          const start = ctx.currentTime + i * (duration + gap)
          osc.start(start)
          osc.stop(start + duration)
        }
        // Auto-stop after tones finish
        const totalTime = tones.length * (duration + gap) * 1000 + 200
        setTimeout(() => {
          if (!cancelled) setTestingSpeaker(false)
        }, totalTime)
      } catch {
        setTestingSpeaker(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [testingSpeaker, voiceSettings?.outputDeviceId])

  const handleToggleEnable = async (): Promise<void> => {
    const newEnabled = !voiceSettings?.enabled
    await updateSetting('enabled', newEnabled)
    if (newEnabled && !enabled) {
      await enable()
    } else if (!newEnabled && enabled) {
      disable()
    }
  }

  if (!voiceSettings) return <div />

  return (
    <div className="flex flex-col h-full rounded-lg border border-[var(--color-border)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--color-border)]">
        <Radio size={20} className="text-[var(--color-accent)]" />
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('voiceChat.title')}</h1>
        <div className="ml-auto flex items-center gap-3">
          {enabled && (
            <span className="flex items-center gap-1.5 text-xs text-green-400">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              {t('voiceChat.connectedPeers', { count: peers.length })}
            </span>
          )}
          <button
            onClick={handleToggleEnable}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              voiceSettings.enabled
                ? 'bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25'
                : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:bg-[var(--color-surface)]'
            }`}
          >
            {voiceSettings.enabled ? (
              <>
                <ToggleRight size={16} /> {t('voiceChat.enabled')}
              </>
            ) : (
              <>
                <ToggleLeft size={16} /> {t('voiceChat.disabled')}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Info banner */}
        <div className="flex items-start gap-3 p-4 rounded-lg bg-[var(--color-accent)]/5 border border-[var(--color-accent)]/15">
          <AlertCircle size={16} className="text-[var(--color-accent)] mt-0.5 shrink-0" />
          <div className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
            {t('voiceChat.infoBanner')}
          </div>
        </div>

        {/* ── Input Device ── */}
        <Section title={t('voiceChat.microphone')} icon={Mic}>
          <div className="space-y-4">
            <div>
              <Label>{t('voiceChat.inputDevice')}</Label>
              <select
                value={voiceSettings.inputDeviceId ?? ''}
                onChange={(e) =>
                  updateSetting('inputDeviceId', e.target.value || null)
                }
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
              >
                <option value="">{t('voiceChat.systemDefault')}</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${d.deviceId.substring(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>{t('voiceChat.inputGain', { value: Math.round(voiceSettings.inputGain * 100) })}</Label>
              <input
                type="range"
                min={0}
                max={300}
                value={Math.round(voiceSettings.inputGain * 100)}
                onChange={(e) =>
                  updateSetting('inputGain', parseInt(e.target.value) / 100)
                }
                className="w-full accent-[var(--color-accent)]"
              />
            </div>

            {/* Mic test */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTestingMic(!testingMic)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  testingMic
                    ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:bg-[var(--color-surface)]'
                }`}
              >
                {testingMic ? <MicOff size={14} /> : <Mic size={14} />}
                {testingMic ? t('voiceChat.stopTest') : t('voiceChat.testMicrophone')}
              </button>
              {testingMic && (
                <div className="flex-1 h-3 bg-[var(--color-surface)] rounded-full overflow-hidden border border-[var(--color-border)]">
                  <div
                    className="h-full bg-green-500 transition-all duration-75 rounded-full"
                    style={{ width: `${Math.min(100, micLevel * 100)}%` }}
                  />
                </div>
              )}
            </div>

            {/* Transmit test — sends a test tone to connected peers */}
            <div className="flex items-center gap-3">
              <button
                onClick={testTransmit}
                disabled={!enabled}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:bg-[var(--color-surface)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send size={14} />
                {t('voiceChat.testTransmit')}
              </button>
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {t('voiceChat.testTransmitHint')}
              </span>
            </div>
          </div>
        </Section>

        {/* ── Output ── */}
        <Section title={t('voiceChat.output')} icon={Volume2}>
          <div className="space-y-4">
            <div>
              <Label>{t('voiceChat.outputDevice')}</Label>
              <select
                value={voiceSettings.outputDeviceId ?? ''}
                onChange={(e) =>
                  updateSetting('outputDeviceId', e.target.value || null)
                }
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
              >
                <option value="">{t('voiceChat.systemDefault')}</option>
                {outputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Speaker ${d.deviceId.substring(0, 8)}`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>{t('voiceChat.outputVolume', { value: Math.round(voiceSettings.outputVolume * 100) })}</Label>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(voiceSettings.outputVolume * 100)}
                onChange={(e) =>
                  updateSetting('outputVolume', parseInt(e.target.value) / 100)
                }
                className="w-full accent-[var(--color-accent)]"
              />
            </div>

            {/* Speaker test */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTestingSpeaker(!testingSpeaker)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  testingSpeaker
                    ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:bg-[var(--color-surface)]'
                }`}
              >
                {testingSpeaker ? <Square size={14} /> : <Play size={14} />}
                {testingSpeaker ? t('voiceChat.stopSpeakerTest') : t('voiceChat.testSpeaker')}
              </button>
            </div>
          </div>
        </Section>

        {/* ── Activation Mode ── */}
        <Section title={t('voiceChat.activation')} icon={Keyboard}>
          <div className="space-y-4">
            <div className="flex gap-3">
              <ModeButton
                active={voiceSettings.mode === 'vad'}
                onClick={() => updateSetting('mode', 'vad' as VoiceChatMode)}
                label={t('voiceChat.voiceActivity')}
                description={t('voiceChat.voiceActivityDesc')}
              />
              <ModeButton
                active={voiceSettings.mode === 'ptt'}
                onClick={() => updateSetting('mode', 'ptt' as VoiceChatMode)}
                label={t('voiceChat.pushToTalk')}
                description={t('voiceChat.pushToTalkDesc')}
              />
            </div>

            {voiceSettings.mode === 'ptt' && (
              <div>
                <Label>{t('voiceChat.pttKey')}</Label>
                <button
                  onClick={() => setCapturingKey(true)}
                  className={`px-4 py-2 rounded-lg text-sm font-mono transition-colors ${
                    capturingKey
                      ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] border-2 border-[var(--color-accent)] animate-pulse'
                      : 'bg-[var(--color-surface)] text-[var(--color-text-primary)] border border-[var(--color-border)] hover:bg-[var(--color-surface)]'
                  }`}
                >
                  {capturingKey ? t('voiceChat.pressAnyKey') : voiceSettings.pttKey.replace('Key', '')}
                </button>
              </div>
            )}

            {voiceSettings.mode === 'vad' && (
              <div>
                <Label>{t('voiceChat.sensitivity', { value: Math.round(voiceSettings.vadThreshold * 100) })}</Label>
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={Math.round(voiceSettings.vadThreshold * 100)}
                  onChange={(e) =>
                    updateSetting('vadThreshold', parseInt(e.target.value) / 100)
                  }
                  className="w-full accent-[var(--color-accent)]"
                />
                <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                  {t('voiceChat.sensitivityHint')}
                </p>
              </div>
            )}
          </div>
        </Section>

        {/* ── Proximity / Spatial ── */}
        <Section title={t('voiceChat.spatialAudio')} icon={Gauge}>
          <div className="space-y-4">
            <div>
              <Label>{t('voiceChat.proximityRange', { value: voiceSettings.proximityRange })}</Label>
              <input
                type="range"
                min={10}
                max={200}
                step={5}
                value={voiceSettings.proximityRange}
                onChange={(e) =>
                  updateSetting('proximityRange', parseInt(e.target.value))
                }
                className="w-full accent-[var(--color-accent)]"
              />
              <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                {t('voiceChat.proximityRangeHint')}
              </p>
            </div>

            <ToggleSetting
              label={t('voiceChat.doorMuffling')}
              description={t('voiceChat.doorMufflingDesc')}
              icon={DoorOpen}
              enabled={voiceSettings.doorMuffling}
              onToggle={() => updateSetting('doorMuffling', !voiceSettings.doorMuffling)}
            />
          </div>
        </Section>

        {/* ── Networking / TURN ── */}
        <Section title={t('voiceChat.networking')} icon={Globe}>
          <div className="space-y-4">
            <div>
              <Label>{t('voiceChat.turnServerUrl')}</Label>
              <input
                type="text"
                value={voiceSettings.turnServerUrl ?? ''}
                onChange={(e) =>
                  updateSetting('turnServerUrl', e.target.value || null)
                }
                placeholder={t('voiceChat.turnServerUrlPlaceholder')}
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]/40 focus:outline-none focus:border-[var(--color-accent)]"
              />
              <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                {t('voiceChat.turnServerUrlHint')}
              </p>
            </div>

            {voiceSettings.turnServerUrl && (
              <>
                <div>
                  <Label>{t('voiceChat.turnUsername')}</Label>
                  <input
                    type="text"
                    value={voiceSettings.turnUsername ?? ''}
                    onChange={(e) =>
                      updateSetting('turnUsername', e.target.value || null)
                    }
                    className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
                <div>
                  <Label>{t('voiceChat.turnCredential')}</Label>
                  <input
                    type="password"
                    value={voiceSettings.turnCredential ?? ''}
                    onChange={(e) =>
                      updateSetting('turnCredential', e.target.value || null)
                    }
                    className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
              </>
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}

/* ── Reusable sub-components ── */

function Section({
  title,
  icon: Icon,
  children
}: {
  title: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section>
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2 mb-4">
        <Icon size={16} className="text-[var(--color-accent)]" />
        {title}
      </h2>
      <div className="pl-6">{children}</div>
    </section>
  )
}

function Label({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="block text-[13px] text-[var(--color-text-secondary)] mb-1.5">
      {children}
    </label>
  )
}

function ModeButton({
  active,
  onClick,
  label,
  description
}: {
  active: boolean
  onClick: () => void
  label: string
  description: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-start gap-1 p-3 rounded-lg border transition-colors text-left ${
        active
          ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]/30 text-[var(--color-accent)]'
          : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'
      }`}
    >
      <div className="flex items-center gap-2">
        {active && <Check size={14} />}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="text-[11px] opacity-70">{description}</span>
    </button>
  )
}

function ToggleSetting({
  label,
  description,
  icon: Icon,
  enabled,
  onToggle
}: {
  label: string
  description: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  enabled: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex items-start gap-3">
        <Icon size={16} className="text-[var(--color-text-muted)] mt-0.5" />
        <div>
          <div className="text-[13px] text-[var(--color-text-primary)]">{label}</div>
          <div className="text-[11px] text-[var(--color-text-muted)]">{description}</div>
        </div>
      </div>
      <button
        onClick={onToggle}
        className={`shrink-0 w-10 h-5 rounded-full transition-colors relative ${
          enabled
            ? 'bg-[var(--color-accent)]'
            : 'bg-[var(--color-surface)] border border-[var(--color-border)]'
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-[var(--color-text-primary)] shadow transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}
