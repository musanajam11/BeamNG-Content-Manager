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
  type SpatialPeerAudio
} from '../utils/spatialAudio'

interface PeerConnection {
  playerId: number
  playerName: string
  pc: RTCPeerConnection
  stream: MediaStream | null
  audio: SpatialPeerAudio | null
  speaking: boolean
  makingOffer: boolean
}

interface VoiceChatState {
  enabled: boolean
  available: boolean
  localStream: MediaStream | null
  peers: Map<number, PeerConnection>
  settings: VoiceChatSettings
  pttActive: boolean

  // Actions
  enable: () => Promise<void>
  disable: () => void
  updateSettings: (partial: Partial<VoiceChatSettings>) => void
  handlePeerJoined: (playerId: number, playerName: string) => void
  handlePeerLeft: (playerId: number) => void
  handleSignal: (fromId: number, payload: string) => void
  updateSpatialAudio: (telemetry: GPSTelemetry) => void
  setPttActive: (active: boolean) => void
  getPeerList: () => VoicePeerInfo[]
  cleanup: () => void
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
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
  doorMuffling: true,
  turnServerUrl: null,
  turnUsername: null,
  turnCredential: null
}

// Track speaking detection interval outside store
let speakingInterval: ReturnType<typeof setInterval> | null = null

export const useVoiceChatStore = create<VoiceChatState>((set, get) => ({
  enabled: false,
  available: false,
  localStream: null,
  peers: new Map(),
  settings: DEFAULT_SETTINGS,
  pttActive: false,

  enable: async () => {
    const { settings } = get()
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(settings.inputDeviceId ? { deviceId: { exact: settings.inputDeviceId } } : {})
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)

      // Apply input gain via AudioContext
      const ctx = getAudioContext()

      // Route output to selected device
      if (settings.outputDeviceId) {
        await setOutputDevice(settings.outputDeviceId)
      }

      const source = ctx.createMediaStreamSource(stream)
      const gainNode = ctx.createGain()
      gainNode.gain.value = settings.inputGain
      const dest = ctx.createMediaStreamDestination()
      source.connect(gainNode)
      gainNode.connect(dest)

      set({ enabled: true, available: true, localStream: dest.stream })

      // Enable voice on the server side
      await window.api.voiceEnable()

      // Start speaking detection
      speakingInterval = setInterval(() => {
        const { peers, settings: s } = get()
        let changed = false
        const updatedPeers = new Map(peers)
        for (const [, peer] of updatedPeers) {
          if (peer.audio) {
            const speaking = isPeerSpeaking(peer.audio, s.vadThreshold)
            if (speaking !== peer.speaking) {
              peer.speaking = speaking
              changed = true
            }
          }
        }
        if (changed) set({ peers: updatedPeers })
      }, 100)
    } catch (err) {
      console.error('[VoiceChat] Failed to enable:', err)
    }
  },

  disable: () => {
    const { localStream, peers } = get()

    // Stop speaking detection
    if (speakingInterval) {
      clearInterval(speakingInterval)
      speakingInterval = null
    }

    // Close all peer connections
    for (const [, peer] of peers) {
      if (peer.audio) destroyPeerAudio(peer.audio)
      peer.pc.close()
    }

    // Stop local tracks
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop())
    }

    closeAudioContext()
    set({ enabled: false, localStream: null, peers: new Map() })
    window.api.voiceDisable().catch(() => {})
  },

  updateSettings: (partial) => {
    const { settings, localStream } = get()
    const updated = { ...settings, ...partial }
    set({ settings: updated })

    // Live-update input gain if stream is active
    if (partial.inputGain !== undefined && localStream) {
      // Gain is handled at enable time; a re-enable would be needed for device change
    }

    // Live-update output device
    if (partial.outputDeviceId !== undefined) {
      setOutputDevice(partial.outputDeviceId).catch(() => {})
    }

    // Persist
    window.api.voiceUpdateSettings(updated).catch(() => {})
  },

  handlePeerJoined: (playerId, playerName) => {
    const { peers, localStream, settings } = get()
    if (peers.has(playerId)) return

    const pc = new RTCPeerConnection({ iceServers: buildIceServers(settings) })
    const peer: PeerConnection = {
      playerId,
      playerName,
      pc,
      stream: null,
      audio: null,
      speaking: false,
      makingOffer: false
    }

    // Add local audio track
    if (localStream) {
      for (const track of localStream.getAudioTracks()) {
        pc.addTrack(track, localStream)
      }
    }

    // Handle remote audio track
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams
      if (remoteStream) {
        peer.stream = remoteStream
        peer.audio = createPeerAudio(remoteStream, settings.proximityRange)
        const updatedPeers = new Map(get().peers)
        updatedPeers.set(playerId, peer)
        set({ peers: updatedPeers })
      }
    }

    // ICE candidate exchange
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const signal = JSON.stringify({ type: 'ice', data: event.candidate })
        window.api.voiceSendSignal(playerId.toString() + '|' + signal).catch(() => {})
      }
    }

    // Negotiation
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        const signal = JSON.stringify({ type: 'offer', data: pc.localDescription })
        await window.api.voiceSendSignal(playerId.toString() + '|' + signal)
      } catch (err) {
        console.error('[VoiceChat] Negotiation error:', err)
      } finally {
        peer.makingOffer = false
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn(`[VoiceChat] Peer ${playerId} connection ${pc.connectionState}`)
      }
    }

    const updatedPeers = new Map(peers)
    updatedPeers.set(playerId, peer)
    set({ peers: updatedPeers })
  },

  handlePeerLeft: (playerId) => {
    const { peers } = get()
    const peer = peers.get(playerId)
    if (!peer) return

    if (peer.audio) destroyPeerAudio(peer.audio)
    peer.pc.close()

    const updatedPeers = new Map(peers)
    updatedPeers.delete(playerId)
    set({ peers: updatedPeers })
  },

  handleSignal: async (fromId, payload) => {
    const { peers } = get()
    const peer = peers.get(fromId)
    if (!peer) return

    try {
      const signal = JSON.parse(payload)
      const { pc } = peer

      if (signal.type === 'offer') {
        const offerCollision = peer.makingOffer || pc.signalingState !== 'stable'
        // Polite peer: we are polite if our ID is lower
        if (offerCollision) {
          // Ignore the offer — the other side will accept ours
          return
        }
        await pc.setRemoteDescription(new RTCSessionDescription(signal.data))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        const answerSignal = JSON.stringify({ type: 'answer', data: pc.localDescription })
        await window.api.voiceSendSignal(fromId.toString() + '|' + answerSignal)
      } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.data))
      } else if (signal.type === 'ice') {
        await pc.addIceCandidate(new RTCIceCandidate(signal.data))
      }
    } catch (err) {
      console.error(`[VoiceChat] Signal error from ${fromId}:`, err)
    }
  },

  updateSpatialAudio: (telemetry) => {
    const { peers, settings } = get()

    // Update listener position (local player)
    const headingRad = telemetry.heading ?? 0
    updateListenerPosition(
      telemetry.x,
      telemetry.y,
      telemetry.z,
      Math.sin(headingRad),
      Math.cos(headingRad),
      0
    )

    // Update peer positions from telemetry others
    if (!telemetry.otherPlayers) return

    for (const [, peer] of peers) {
      if (!peer.audio) continue

      // Match peer by name from telemetry
      const other = telemetry.otherPlayers.find(
        (o) => o.name === peer.playerName
      )
      if (other) {
        updatePeerPosition(peer.audio, other.x, other.y, other.z)

        // Volume: base output volume * muffle factor
        const muffleFactor = 1.0 // TODO: door muffling from extended telemetry
        setPeerVolume(peer.audio, settings.outputVolume, muffleFactor)
      }
    }
  },

  setPttActive: (active) => {
    const { localStream, settings } = get()
    if (settings.mode !== 'ptt' || !localStream) return
    // Mute/unmute tracks based on PTT state
    for (const track of localStream.getAudioTracks()) {
      track.enabled = active
    }
    set({ pttActive: active })
  },

  getPeerList: () => {
    const { peers } = get()
    const list: VoicePeerInfo[] = []
    for (const [, peer] of peers) {
      list.push({
        playerId: peer.playerId,
        playerName: peer.playerName,
        speaking: peer.speaking
      })
    }
    return list
  },

  cleanup: () => {
    get().disable()
  }
}))
