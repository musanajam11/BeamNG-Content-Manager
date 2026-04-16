import { useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Mic, MicOff, Radio } from 'lucide-react'
import { useVoiceChatStore } from '../stores/useVoiceChatStore'
import { useAppStore } from '../stores/useAppStore'

/**
 * Floating voice chat overlay — shown when voice chat is enabled and connected to a server.
 * Displays mic status, PTT indicator, and nearby speakers with activity indicators.
 */
export function VoiceChatPanel(): React.JSX.Element | null {
  const { t } = useTranslation()
  const enabled = useVoiceChatStore((s) => s.enabled)
  const pttActive = useVoiceChatStore((s) => s.pttActive)
  const settings = useVoiceChatStore((s) => s.settings)
  const setPttActive = useVoiceChatStore((s) => s.setPttActive)
  const handlePeerJoined = useVoiceChatStore((s) => s.handlePeerJoined)
  const handlePeerLeft = useVoiceChatStore((s) => s.handlePeerLeft)
  const handleSignal = useVoiceChatStore((s) => s.handleSignal)
  const updateSpatialAudio = useVoiceChatStore((s) => s.updateSpatialAudio)
  const peersMap = useVoiceChatStore((s) => s.peers)
  const config = useAppStore((s) => s.config)

  const peers = useMemo(() => {
    const list: { playerId: number; playerName: string; speaking: boolean }[] = []
    for (const [, peer] of peersMap) {
      list.push({ playerId: peer.playerId, playerName: peer.playerName, speaking: peer.speaking })
    }
    return list
  }, [peersMap])

  // PTT key handler
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (settings.mode === 'ptt' && e.code === settings.pttKey && !e.repeat) {
        setPttActive(true)
      }
    },
    [settings.mode, settings.pttKey, setPttActive]
  )

  const onKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (settings.mode === 'ptt' && e.code === settings.pttKey) {
        setPttActive(false)
      }
    },
    [settings.mode, settings.pttKey, setPttActive]
  )

  useEffect(() => {
    if (!enabled) return
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [enabled, onKeyDown, onKeyUp])

  // Listen for voice events from main process
  useEffect(() => {
    if (!enabled) return

    const unsubPeerJoined = window.api.onVoicePeerJoined(
      (data: { playerId: number; playerName: string }) => {
        handlePeerJoined(data.playerId, data.playerName)
      }
    )
    const unsubPeerLeft = window.api.onVoicePeerLeft(
      (data: { playerId: number }) => {
        handlePeerLeft(data.playerId)
      }
    )
    const unsubSignal = window.api.onVoiceSignal(
      (data: { fromId: number; payload: string }) => {
        handleSignal(data.fromId, data.payload)
      }
    )

    return () => {
      unsubPeerJoined()
      unsubPeerLeft()
      unsubSignal()
    }
  }, [enabled, handlePeerJoined, handlePeerLeft, handleSignal])

  // Spatial audio updates from GPS telemetry
  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(async () => {
      const telemetry = await window.api.gpsGetTelemetry()
      if (telemetry) {
        updateSpatialAudio(telemetry)
      }
    }, 100) // 10 Hz
    return () => clearInterval(interval)
  }, [enabled, updateSpatialAudio])

  // Don't render if voice chat is disabled
  if (!enabled || !config?.voiceChat?.enabled) return null

  const isMuted = settings.mode === 'ptt' ? !pttActive : false
  const MicIcon = isMuted ? MicOff : Mic

  return (
    <div className="fixed bottom-16 right-4 z-50 pointer-events-auto">
      <div className="bg-black/80 backdrop-blur-md border border-[var(--color-border)] rounded-xl p-3 min-w-[180px] shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <Radio size={14} className="text-[var(--color-accent)]" />
          <span className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
            {t('voiceChat.panel.title')}
          </span>
          <div
            className={`ml-auto w-2 h-2 rounded-full ${
              isMuted ? 'bg-red-500' : 'bg-green-500 animate-pulse'
            }`}
          />
        </div>

        {/* Mic status */}
        <div
          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg mb-2 transition-colors ${
            isMuted ? 'bg-red-500/10' : 'bg-green-500/10'
          }`}
        >
          <MicIcon
            size={14}
            className={isMuted ? 'text-red-400' : 'text-green-400'}
          />
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {settings.mode === 'ptt'
              ? pttActive
                ? t('voiceChat.panel.transmitting')
                : t('voiceChat.panel.pttHint', { key: settings.pttKey.replace('Key', '') })
              : t('voiceChat.panel.voiceActive')}
          </span>
        </div>

        {/* Nearby speakers */}
        {peers.length > 0 && (
          <div className="flex flex-col gap-1">
            {peers.map((peer) => (
              <div
                key={peer.playerId}
                className="flex items-center gap-2 px-2 py-1 rounded-md"
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    peer.speaking ? 'bg-green-400' : 'bg-slate-600'
                  }`}
                />
                <span className="text-[11px] text-[var(--color-text-muted)] truncate">
                  {peer.playerName}
                </span>
              </div>
            ))}
          </div>
        )}

        {peers.length === 0 && (
          <div className="text-[11px] text-[var(--color-text-muted)] text-center py-1 opacity-60">
            {t('voiceChat.panel.noNearbyPlayers')}
          </div>
        )}
      </div>
    </div>
  )
}
