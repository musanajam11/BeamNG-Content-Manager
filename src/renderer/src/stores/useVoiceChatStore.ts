import { create } from 'zustand'
import type { VoiceChatSettings, VoicePeerInfo, GPSTelemetry } from '../../../shared/types'
import {
  createPeerAudio,
  destroyPeerAudio,
  updatePeerPosition,
  updateListenerPosition,
  setPeerVolume,
  isPeerSpeaking,
  getAudioContext,
  closeAudioContext,
  setOutputDevice,
  type SpatialPeerAudio,
} from '../utils/spatialAudio'
import { AudioCapture } from '../voice/audio/AudioCapture'
import { JitterBuffer } from '../voice/audio/JitterBuffer'
import { probeOpusSupport } from '../voice/audio/OpusCodec'
import { OpusFrameEncoder } from '../voice/audio/OpusCodec'
import { VOICE_CODEC } from '../voice/transports/types'
import { MeshOrchestrator, MeshSignalEnvelope } from '../voice/MeshElection'
import { VoiceTransportRouter } from '../voice/VoiceTransportRouter'
import { broadcastTier3 } from '../voice/transports/BeamMpRelayTransport'
import { startVoiceLoopback, type LoopbackHandle } from '../voice/loopback'
import {
  OpusFrame,
  TIER_BADGE,
  VoiceTier,
  VoiceTransportState,
} from '../voice/transports/types'
import type { WebRtcSignal } from '../voice/transports/WebRtcTransport'

interface PeerConnection {
  playerId: number
  playerName: string
  router: VoiceTransportRouter
  jitter: JitterBuffer | null
  audio: SpatialPeerAudio | null
  speaking: boolean
  polite: boolean
  /** UI-friendly state derived from router state. */
  connState: RTCPeerConnectionState
  /** Currently active tier per the router. Null while still probing. */
  tier: VoiceTier | null
}

interface VoiceChatStore {
  enabled: boolean
  available: boolean
  /** Original mic stream (kept for PTT mute & input-gain debugging). */
  localStream: MediaStream | null
  /** Single shared AudioContext gain on the legacy transmit chain (kept for testTransmit). */
  transmitGainNode: GainNode | null
  peers: Map<number, PeerConnection>
  settings: VoiceChatSettings
  pttActive: boolean
  /** User toggled self-mute via overlay or settings UI (separate from PTT auto-mute). */
  selfMuted: boolean
  /** Peer ids the user has muted via the overlay. Audio frames are dropped on the input side. */
  mutedPeerIds: Set<number>

  // Actions
  enable: () => Promise<void>
  disable: () => void
  updateSettings: (partial: Partial<VoiceChatSettings>) => void
  handlePeerJoined: (playerId: number, playerName: string, polite?: boolean) => void
  handlePeerLeft: (playerId: number) => void
  handleSignal: (fromId: number, payload: string) => void
  setSelfId: (selfId: number) => void
  updateSpatialAudio: (telemetry: GPSTelemetry) => void
  setPttActive: (active: boolean) => void
  setSelfMuted: (muted: boolean) => void
  togglePeerMute: (peerId: number) => void
  testTransmit: () => Promise<void>
  testTransmitToPeers: () => Promise<void>
  getPeerList: () => VoicePeerInfo[]
  cleanup: () => void
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

function buildIceServers(settings: VoiceChatSettings): RTCIceServer[] {
  const servers = [...ICE_SERVERS]
  if (settings.turnServerUrl) {
    const turn: RTCIceServer = { urls: settings.turnServerUrl }
    if (settings.turnUsername) turn.username = settings.turnUsername
    if (settings.turnCredential) turn.credential = settings.turnCredential
    servers.push(turn)
  }
  return servers
}

const DEFAULT_SETTINGS: VoiceChatSettings = {
  enabled: false,
  inputDeviceId: null,
  inputGain: 1.0,
  outputVolume: 0.8,
  outputDeviceId: null,
  mode: 'vad',
  pttKey: 'KeyV',
  vadThreshold: 0.02,
  proximityRange: 50,
  turnServerUrl: null,
  turnUsername: null,
  turnCredential: null,
}

// Module-scope mutable resources. Kept outside the store so React's
// re-render pipeline never wraps them in a Proxy.
let speakingInterval: ReturnType<typeof setInterval> | null = null
let audioCapture: AudioCapture | null = null
let captureMuted = false
let meshOrchestrator: MeshOrchestrator | null = null
let selfPlayerId: number | null = null
let activeLoopback: LoopbackHandle | null = null
let activeTonePeerTest: { stop: () => void } | null = null
/** Global PTT key listeners installed in enable(), torn down in disable(). */
let pttKeyDownHandler: ((e: KeyboardEvent) => void) | null = null
let pttKeyUpHandler: ((e: KeyboardEvent) => void) | null = null

/** True when a key event originates from a text input / editable surface. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

function routerStateToConn(s: VoiceTransportState): RTCPeerConnectionState {
  switch (s) {
    case 'idle':
      return 'new'
    case 'connecting':
      return 'connecting'
    case 'connected':
      return 'connected'
    case 'failed':
      return 'failed'
    case 'closed':
      return 'closed'
  }
}

/**
 * Fan an outgoing Opus frame to every peer's transport.
 *
 * Proximity attenuation is intentionally applied on the *receive* side via
 * spatialAudio.setPeerVolume — it tapers gain to 0 at proximityRange and
 * fully mutes beyond. We don't gate on the send side because:
 *   - the renderer's distance estimate depends on GPS telemetry being live
 *     and player-name matching, which can fail silently and would then
 *     hard-mute peers that should be audible;
 *   - WebRTC bandwidth for one Opus stream is trivial.
 */
function fanoutFrame(peers: Map<number, PeerConnection>, frame: OpusFrame): void {
  let anyTier3 = false
  for (const peer of peers.values()) {
    if (peer.tier === VoiceTier.Server) {
      anyTier3 = true
      continue // tier-3 outbound is a single broadcast, see below
    }
    peer.router.send(frame)
  }
  // One broadcast covers every tier-3 peer at once (the BeamMP server
  // fans out for us). Skip if no tier-3 peer is currently active.
  if (anyTier3) broadcastTier3(frame)
}

export const useVoiceChatStore = create<VoiceChatStore>((set, get) => ({
  enabled: false,
  available: false,
  localStream: null,
  transmitGainNode: null,
  peers: new Map(),
  settings: DEFAULT_SETTINGS,
  pttActive: false,
  selfMuted: false,
  mutedPeerIds: new Set<number>(),

  enable: async () => {
    const { settings } = get()
    // Register on the BeamMP server FIRST so we appear in the voice peer
    // list even if the local audio stack fails to initialise (e.g. mic
    // denied, no input device, Opus codec missing). Other voice peers can
    // still be discovered and we get the in-game overlay status update.
    // Previously this happened only after getUserMedia + AudioCapture
    // succeeded, which silently dropped server-side enable on any audio
    // failure — leaving us invisible to the server and to other voice
    // peers.
    set({ enabled: true, available: true })
    try {
      console.log('[VoiceChat] Sending vc_enable to server (signal-only, audio init follows)')
      await window.api.voiceEnable()
    } catch (err) {
      console.error('[VoiceChat] window.api.voiceEnable() failed:', err)
    }
    try {
      const support = await probeOpusSupport()
      if (!support.encoder || !support.decoder) {
        console.error('[VoiceChat] Opus unavailable — staying signal-only:', support.reason)
        try {
          window.dispatchEvent(new CustomEvent('voicechat:audio-error', { detail: 'Opus codec unavailable: ' + (support.reason ?? 'unknown') }))
        } catch { /* ignore */ }
        return
      }
      console.log('[VoiceChat] Opus support OK', support)

      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(settings.inputDeviceId ? { deviceId: { exact: settings.inputDeviceId } } : {}),
        },
      }
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch (mediaErr) {
        const msg = mediaErr instanceof Error ? mediaErr.message : String(mediaErr)
        console.error('[VoiceChat] getUserMedia failed:', msg)
        try {
          window.dispatchEvent(new CustomEvent('voicechat:audio-error', { detail: 'Microphone access denied or unavailable: ' + msg }))
        } catch { /* ignore */ }
        throw mediaErr
      }
      console.log(`[VoiceChat] Got mic stream: ${stream.getAudioTracks().length} track(s), id=${stream.id}`)

      const ctx = getAudioContext()
      if (settings.outputDeviceId) await setOutputDevice(settings.outputDeviceId)

      // Legacy testTransmit chain â€” kept so the speaker-test button still
      // works. Doesn't actually feed any peer transport.
      const source = ctx.createMediaStreamSource(stream)
      const gainNode = ctx.createGain()
      gainNode.gain.value = settings.inputGain
      const dest = ctx.createMediaStreamDestination()
      source.connect(gainNode).connect(dest)

      // Hybrid audio capture â†’ Opus â†’ fan-out to all peer routers.
      // PTT mode starts muted by default — the mic only opens while the
      // PTT key is held. VAD mode uses an input-side level gate.
      captureMuted = settings.mode === 'ptt'
      audioCapture = new AudioCapture({ stream, gain: settings.inputGain, muted: captureMuted })
      audioCapture.setVadGate(settings.mode === 'vad' ? settings.vadThreshold : null)
      audioCapture.on('frame', (frame) => fanoutFrame(get().peers, frame))
      audioCapture.on('error', (e) => {
        console.error('[VoiceChat] capture error', e)
        try {
          window.dispatchEvent(new CustomEvent('voicechat:audio-error', { detail: 'Audio capture error: ' + (e?.message ?? String(e)) }))
        } catch { /* ignore */ }
      })
      try {
        await audioCapture.start()
        console.log('[VoiceChat] AudioCapture started — Opus frames will now be sent to peers')
      } catch (capErr) {
        const msg = capErr instanceof Error ? capErr.message : String(capErr)
        console.error('[VoiceChat] AudioCapture.start() failed:', msg)
        try {
          window.dispatchEvent(new CustomEvent('voicechat:audio-error', { detail: 'Audio capture failed to start: ' + msg }))
        } catch { /* ignore */ }
        throw capErr
      }

      // Mesh tier orchestrator. selfPlayerId is set lazily on first peer
      // join (see handlePeerJoined) because we don't yet have a clean way
      // to know our own BeamMP id at enable time.
      meshOrchestrator = new MeshOrchestrator({
        selfId: selfPlayerId,
        sendSignal: (env: MeshSignalEnvelope) => {
          const wire = JSON.stringify(env)
          // Send the mesh envelope as a broadcast voice signal addressed to
          // pseudo-target id 0 — the receiver demuxes by JSON kind.
          window.api.voiceSendSignal(`0|${wire}`).catch(() => undefined)
        },
      })
      void meshOrchestrator.start()

      set({
        enabled: true,
        available: true,
        localStream: dest.stream,
        transmitGainNode: gainNode,
        pttActive: false,
      })

      // Global PTT key listeners — must survive panel mount/unmount so the
      // mic stays gated when the overlay isn't visible. Skip when the user
      // is typing in an editable element so PTT keys (often letter keys)
      // don't open the mic during chat / search / form input.
      if (pttKeyDownHandler) window.removeEventListener('keydown', pttKeyDownHandler)
      if (pttKeyUpHandler) window.removeEventListener('keyup', pttKeyUpHandler)
      pttKeyDownHandler = (e: KeyboardEvent): void => {
        const s = get().settings
        if (s.mode !== 'ptt' || e.code !== s.pttKey || e.repeat) return
        if (isEditableTarget(e.target)) return
        get().setPttActive(true)
      }
      pttKeyUpHandler = (e: KeyboardEvent): void => {
        const s = get().settings
        if (s.mode !== 'ptt' || e.code !== s.pttKey) return
        if (isEditableTarget(e.target)) return
        get().setPttActive(false)
      }
      window.addEventListener('keydown', pttKeyDownHandler)
      window.addEventListener('keyup', pttKeyUpHandler)

      // VAD speaking detection on remote peers.
      speakingInterval = setInterval(() => {
        const { peers, settings: s } = get()
        let changed = false
        const updated = new Map(peers)
        for (const [, p] of updated) {
          if (p.audio) {
            const speaking = isPeerSpeaking(p.audio, s.vadThreshold)
            if (speaking !== p.speaking) {
              p.speaking = speaking
              changed = true
            }
          }
        }
        if (changed) set({ peers: updated })
      }, 100)
    } catch (err) {
      console.error('[VoiceChat] Failed to enable audio (signal-only mode active):', err)
      // Surface a UI hint so the user knows audio failed even though the
      // server-side registration succeeded.
      try {
        window.dispatchEvent(new CustomEvent('voicechat:audio-error', { detail: String(err) }))
      } catch { /* ignore */ }
    }
  },

  disable: () => {
    const { localStream, peers } = get()

    if (speakingInterval) {
      clearInterval(speakingInterval)
      speakingInterval = null
    }

    for (const [, peer] of peers) {
      if (peer.audio) destroyPeerAudio(peer.audio)
      peer.jitter?.close()
      peer.router.close('voice disabled')
    }

    if (audioCapture) {
      void audioCapture.stop()
      audioCapture = null
    }
    captureMuted = false
    if (pttKeyDownHandler) {
      window.removeEventListener('keydown', pttKeyDownHandler)
      pttKeyDownHandler = null
    }
    if (pttKeyUpHandler) {
      window.removeEventListener('keyup', pttKeyUpHandler)
      pttKeyUpHandler = null
    }
    if (meshOrchestrator) {
      meshOrchestrator.stop()
      meshOrchestrator = null
    }
    if (localStream) localStream.getTracks().forEach((t) => t.stop())

    closeAudioContext()
    set({ enabled: false, localStream: null, transmitGainNode: null, peers: new Map(), pttActive: false })
    window.api.voiceDisable().catch(() => undefined)
  },

  updateSettings: (partial) => {
    const { settings } = get()
    const updated = { ...settings, ...partial }
    set({ settings: updated })

    if (partial.inputGain !== undefined && audioCapture) {
      audioCapture.setGain(partial.inputGain)
    }
    if (partial.outputDeviceId !== undefined) {
      setOutputDevice(partial.outputDeviceId).catch(() => undefined)
    }
    // React to transmit-gating settings live so the user doesn't have to
    // toggle voice chat off and on after changing mode or threshold.
    if (audioCapture && (partial.mode !== undefined || partial.vadThreshold !== undefined)) {
      audioCapture.setVadGate(updated.mode === 'vad' ? updated.vadThreshold : null)
      if (updated.mode === 'ptt') {
        // Switching into PTT — close the mic until the key is held.
        captureMuted = true
        audioCapture.setMuted(captureMuted || get().selfMuted)
        set({ pttActive: false })
      } else {
        // Switching into VAD — unmute (gate is now level-based).
        captureMuted = false
        audioCapture.setMuted(get().selfMuted)
      }
    }
    window.api.voiceUpdateSettings(updated).catch(() => undefined)
  },

  handlePeerJoined: (playerId, playerName, polite = false) => {
    const { peers, settings } = get()
    if (peers.has(playerId)) {
      console.log(`[VoiceChat] Peer ${playerId} already known, skipping`)
      return
    }
    console.log(
      `[VoiceChat] handlePeerJoined: ${playerName} (id=${playerId}, polite=${polite})`,
    )

    const ctx = getAudioContext()

    const router = new VoiceTransportRouter({
      remotePlayerId: playerId,
      polite,
      iceServers: buildIceServers(settings),
      sendWebRtcSignal: (s: WebRtcSignal) => {
        const wire = JSON.stringify({ type: s.type, data: s.data })
        window.api.voiceSendSignal(`${playerId}|${wire}`).catch((err) => {
          console.error('[VoiceChat] sendSignal failed', err)
        })
      },
      meshFactory: () => meshOrchestrator?.getMeshTransport(playerId) ?? null,
    })

    const peer: PeerConnection = {
      playerId,
      playerName,
      router,
      jitter: null,
      audio: null,
      speaking: false,
      polite,
      connState: 'new',
      tier: null,
    }

    router.on('frame', (frame) => {
      const cur = get().peers.get(playerId)
      if (!cur) return
      // Lazy-create the jitter buffer + spatial audio chain on first frame.
      if (!cur.jitter) {
        const jb = new JitterBuffer({ audioContext: ctx })
        void jb.start()
        const spatial = createPeerAudio(jb.outputNode, get().settings.proximityRange)
        cur.jitter = jb
        cur.audio = spatial
        const next = new Map(get().peers)
        next.set(playerId, cur)
        set({ peers: next })
        console.log(
          `[VoiceChat] First inbound frame from peer ${playerId} — jitter buffer + audio chain created (ctx.sampleRate=${ctx.sampleRate}, ctx.state=${ctx.state})`,
        )
        // Periodic stats so we can see whether decode + playback is keeping up.
        // Dev-only: in production this would accumulate console history
        // forever (one line per peer every 5 s ≈ 100 lines/min with 8 peers),
        // bloating the renderer process over multi-hour sessions.
        if (import.meta.env.DEV) {
          const statsTimer = setInterval(() => {
            const p = get().peers.get(playerId)
            if (!p?.jitter) {
              clearInterval(statsTimer)
              return
            }
            const s = p.jitter.getStats()
            console.log(
              `[VoiceChat] peer ${playerId} jitter: played=${s.played} dropped=${s.dropped} lost=${s.lost} buffered=${s.buffered} playing=${s.playing}`,
            )
          }, 5000)
        }
      }
      cur.jitter.push(frame)
    })

    router.on('state', (s, reason) => {
      const cur = get().peers.get(playerId)
      if (!cur) return
      cur.connState = routerStateToConn(s)
      const next = new Map(get().peers)
      next.set(playerId, cur)
      set({ peers: next })
      if (s === 'failed') {
        console.warn(`[VoiceChat] peer ${playerId} state failed: ${reason ?? ''}`)
      }
    })

    router.on('tier', (tier, reason) => {
      const cur = get().peers.get(playerId)
      if (!cur) return
      cur.tier = tier
      const next = new Map(get().peers)
      next.set(playerId, cur)
      set({ peers: next })
      console.log(
        `[VoiceChat] peer ${playerId} tier=${TIER_BADGE[tier].emoji} ${TIER_BADGE[tier].label} (${reason ?? ''})`,
      )
    })

    router.on('backpressure', (n) => {
      if (n > 5000) console.warn(`[VoiceChat] peer ${playerId} backpressure ${n}B`)
    })

    void router.start()

    const updatedPeers = new Map(peers)
    updatedPeers.set(playerId, peer)
    set({ peers: updatedPeers })
  },

  handlePeerLeft: (playerId) => {
    const { peers } = get()
    const peer = peers.get(playerId)
    if (!peer) return
    if (peer.audio) destroyPeerAudio(peer.audio)
    peer.jitter?.close()
    peer.router.close('peer left')
    const next = new Map(peers)
    next.delete(playerId)
    set({ peers: next })
  },

  handleSignal: (fromId, payload) => {
    // Mesh envelopes are JSON with a `kind: 'mesh:*'` discriminator and arrive
    // on the same `voice:signal` channel as WebRTC signals. Try mesh first.
    try {
      const probe = JSON.parse(payload) as { kind?: string }
      if (probe && typeof probe.kind === 'string' && probe.kind.startsWith('mesh:')) {
        meshOrchestrator?.handleSignal(fromId, probe as MeshSignalEnvelope)
        return
      }
    } catch {
      // not JSON, fall through to WebRTC handling
    }

    const peer = get().peers.get(fromId)
    if (!peer) {
      console.warn(`[VoiceChat] Signal from unknown peer ${fromId}, ignoring`)
      return
    }
    try {
      const parsed = JSON.parse(payload) as WebRtcSignal
      void peer.router.handleWebRtcSignal(parsed)
    } catch (err) {
      console.error(`[VoiceChat] Signal parse error from ${fromId}:`, err)
    }
  },

  setSelfId: (id) => {
    selfPlayerId = id
    meshOrchestrator?.setSelfId(id)
  },

  updateSpatialAudio: (telemetry) => {
    const { peers, settings } = get()

    const headingRad = telemetry.heading ?? 0
    updateListenerPosition(
      telemetry.x,
      telemetry.y,
      telemetry.z,
      Math.sin(headingRad),
      Math.cos(headingRad),
      0,
    )

    if (!telemetry.otherPlayers) return
    for (const [, peer] of peers) {
      if (!peer.audio) continue
      const other = telemetry.otherPlayers.find((o) => o.name === peer.playerName)
      if (other) {
        updatePeerPosition(peer.audio, other.x, other.y, other.z)
        const vol = get().mutedPeerIds.has(peer.playerId) ? 0 : settings.outputVolume
        setPeerVolume(peer.audio, vol, settings.proximityRange)
      }
    }
  },

  setPttActive: (active) => {
    const { settings } = get()
    if (settings.mode !== 'ptt') return
    captureMuted = !active
    if (audioCapture) audioCapture.setMuted(captureMuted || get().selfMuted)
    set({ pttActive: active })
  },

  setSelfMuted: (muted) => {
    set({ selfMuted: muted })
    // VAD mode: mute the capture chain immediately. PTT mode: respect PTT state
    // and OR with self-mute so toggling mute while PTT key is up still mutes.
    const effective = muted || captureMuted
    if (audioCapture) audioCapture.setMuted(effective)
  },

  togglePeerMute: (peerId) => {
    const next = new Set(get().mutedPeerIds)
    if (next.has(peerId)) next.delete(peerId)
    else next.add(peerId)
    set({ mutedPeerIds: next })
    const peer = get().peers.get(peerId)
    if (peer?.audio) {
      const vol = next.has(peerId) ? 0 : get().settings.outputVolume
      setPeerVolume(peer.audio, vol, get().settings.proximityRange)
    }
  },

  testTransmit: async () => {
    // Toggleable end-to-end loopback test. Routes mic through the FULL
    // audio pipeline (capture → Opus encode → jitter buffer → Opus decode
    // → spatial gain → speakers) so the user can audibly verify every
    // stage of the receive path without needing a second player. The
    // previous implementation was a 3-tone sine sweep on a fresh
    // AudioContext that bypassed every component that ever fails in
    // practice — it would happily "pass" while real peer audio was
    // completely silent.
    const cur = activeLoopback
    if (cur) {
      activeLoopback = null
      try { await cur.stop() } catch (e) { console.warn('[VoiceChat] loopback stop error', e) }
      try { window.dispatchEvent(new CustomEvent('voicechat:loopback-state', { detail: false })) } catch { /* ignore */ }
      console.log('[VoiceChat] Loopback test stopped')
      return
    }
    try {
      const handle = await startVoiceLoopback()
      activeLoopback = handle
      try { window.dispatchEvent(new CustomEvent('voicechat:loopback-state', { detail: true })) } catch { /* ignore */ }
      console.log('[VoiceChat] Loopback test started — speak; expect ~180ms delay')
      // Periodic stats so devs can confirm frames are flowing.
      const statsTimer = setInterval(() => {
        if (activeLoopback !== handle) {
          clearInterval(statsTimer)
          return
        }
        const s = handle.getStats()
        console.log(
          `[VoiceChat] loopback stats: sent=${s.sent} received=${s.received} jitter=played:${s.jitter.played} dropped:${s.jitter.dropped} lost:${s.jitter.lost} buffered:${s.jitter.buffered} playing:${s.jitter.playing}`,
        )
      }, 2000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[VoiceChat] Loopback test failed to start:', msg)
      try { window.dispatchEvent(new CustomEvent('voicechat:audio-error', { detail: 'Loopback test failed: ' + msg })) } catch { /* ignore */ }
    }
  },

  testTransmitToPeers: async () => {
    // Generate a 440 Hz sine tone, encode it through Opus, and fan it out
    // to peers via the live transmit chain (per-peer router.send + tier-3
    // broadcast). This is the inverse of the loopback test: it bypasses
    // the mic + capture stack and exercises only the outbound encode +
    // transport path so peers can confirm whether they receive anything
    // from us at all. Toggleable; auto-stops after 5 s.
    if (activeTonePeerTest) {
      activeTonePeerTest.stop()
      return
    }
    const { peers, enabled } = get()
    if (!enabled) {
      const msg = 'Voice chat must be enabled to send a tone to peers.'
      console.warn('[VoiceChat] testTransmitToPeers: ' + msg)
      try { window.dispatchEvent(new CustomEvent('voicechat:audio-error', { detail: msg })) } catch { /* ignore */ }
      return
    }
    if (peers.size === 0) {
      const msg = 'No peers connected — nobody to transmit to.'
      console.warn('[VoiceChat] testTransmitToPeers: ' + msg)
      try { window.dispatchEvent(new CustomEvent('voicechat:audio-error', { detail: msg })) } catch { /* ignore */ }
      return
    }

    const support = await probeOpusSupport()
    if (!support.encoder) {
      const msg = 'Opus encoder unavailable: ' + (support.reason ?? 'unknown')
      console.error('[VoiceChat] testTransmitToPeers: ' + msg)
      try { window.dispatchEvent(new CustomEvent('voicechat:audio-error', { detail: msg })) } catch { /* ignore */ }
      return
    }

    const encoder = new OpusFrameEncoder()
    let sentFrames = 0
    encoder.on('frame', (frame) => {
      const cur = get()
      fanoutFrame(cur.peers, frame)
      sentFrames++
    })
    encoder.on('error', (e) => console.error('[VoiceChat] testTransmitToPeers encoder error', e))
    await encoder.start()

    const sampleRate = VOICE_CODEC.sampleRate
    const samplesPerFrame = VOICE_CODEC.samplesPerFrame
    const frameMs = (samplesPerFrame / sampleRate) * 1000
    const freq = 440
    const amplitude = 0.3
    let phase = 0
    const phaseInc = (2 * Math.PI * freq) / sampleRate

    const totalDurationMs = 5000
    const totalFrames = Math.ceil(totalDurationMs / frameMs)
    let framesQueued = 0

    console.log(`[VoiceChat] testTransmitToPeers: sending ${freq}Hz tone to ${peers.size} peer(s) for ${totalDurationMs}ms`)
    try { window.dispatchEvent(new CustomEvent('voicechat:tone-state', { detail: true })) } catch { /* ignore */ }

    const interval = setInterval(() => {
      if (framesQueued >= totalFrames) {
        stop()
        return
      }
      const pcm = new Float32Array(samplesPerFrame)
      for (let i = 0; i < samplesPerFrame; i++) {
        pcm[i] = Math.sin(phase) * amplitude
        phase += phaseInc
        if (phase > 2 * Math.PI) phase -= 2 * Math.PI
      }
      encoder.encode(pcm)
      framesQueued++
    }, frameMs)

    function stop(): void {
      if (activeTonePeerTest?.stop !== handleStop) return // already stopped
      clearInterval(interval)
      try { encoder.close() } catch { /* ignore */ }
      activeTonePeerTest = null
      try { window.dispatchEvent(new CustomEvent('voicechat:tone-state', { detail: false })) } catch { /* ignore */ }
      console.log(`[VoiceChat] testTransmitToPeers: stopped (queued=${framesQueued} sent=${sentFrames})`)
    }
    const handleStop = stop
    activeTonePeerTest = { stop: handleStop }
  },

  getPeerList: () => {
    const { peers } = get()
    const list: VoicePeerInfo[] = []
    for (const [, peer] of peers) {
      list.push({
        playerId: peer.playerId,
        playerName: peer.playerName,
        speaking: peer.speaking,
      })
    }
    return list
  },

  cleanup: () => {
    get().disable()
  },
}))
