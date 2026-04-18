/**
 * Tier 3 transport — BeamMP server audio relay.
 *
 * Architecture: this tier is *broadcast*, not per-peer (we send one audio
 * frame and the server fans it out to every other voice peer). The
 * `VoiceTransport` interface is per-peer, so we use a singleton hub that
 * owns the outgoing broadcast and routes inbound `voice:audio` events to
 * the right per-peer transport instance by `fromId`.
 *
 * The hub also subscribes to `window.api.onVoiceAudio` exactly once per
 * session to avoid duplicate IPC listeners.
 */

import {
  OpusFrame,
  TIER_BADGE,
  VoiceTier,
  VoiceTransport,
  VoiceTransportEvents,
  VoiceTransportState,
  VOICE_CODEC,
} from './types'

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as number[])
  }
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

class BeamMpRelayHub {
  private static _instance: BeamMpRelayHub | null = null
  static get(): BeamMpRelayHub {
    if (!this._instance) this._instance = new BeamMpRelayHub()
    return this._instance
  }

  private peers = new Map<number, BeamMpRelayTransport>()
  private unsubscribe: (() => void) | null = null
  private subscribed = false

  register(t: BeamMpRelayTransport): void {
    this.peers.set(t.remotePlayerId, t)
    this.ensureSubscribed()
  }

  unregister(playerId: number): void {
    this.peers.delete(playerId)
    if (this.peers.size === 0 && this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
      this.subscribed = false
    }
  }

  private ensureSubscribed(): void {
    if (this.subscribed) return
    this.subscribed = true
    this.unsubscribe = window.api.onVoiceAudio((data) => {
      const peer = this.peers.get(data.fromId)
      if (!peer) return
      const frame: OpusFrame = {
        data: base64ToBytes(data.data),
        seq: data.seq & 0xffff,
        timestampUs: data.seq * VOICE_CODEC.frameMs * 1000,
      }
      peer._inject(frame)
    })
  }

  /** Singleton outbound — same audio goes to every voice peer. */
  send(frame: OpusFrame): void {
    const b64 = bytesToBase64(frame.data)
    void window.api.voiceSendAudio({ seq: frame.seq, data: b64 })
  }
}

export class BeamMpRelayTransport implements VoiceTransport {
  readonly tier = VoiceTier.Server
  readonly remotePlayerId: number
  state: VoiceTransportState = 'idle'

  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  private hub = BeamMpRelayHub.get()

  constructor(remotePlayerId: number) {
    this.remotePlayerId = remotePlayerId
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return
    this.setState('connecting')
    this.hub.register(this)
    // Tier 3 is "always works" — once subscribed we're effectively connected.
    this.setState('connected', `via ${TIER_BADGE[this.tier].label}`)
  }

  send(frame: OpusFrame): void {
    // Tier 3 outbound is *broadcast* (server fans out to all voice peers in
    // one shot), so per-peer send would duplicate. The store/router calls
    // `broadcastTier3()` once per frame instead. This is intentionally a
    // no-op so the VoiceTransport interface stays uniform.
    void frame
  }

  /** Called by hub when an inbound audio frame arrives for this peer. */
  _inject(frame: OpusFrame): void {
    if (this.state !== 'connected') return
    this.emit('frame', frame)
  }

  close(reason?: string): void {
    if (this.state === 'closed') return
    this.hub.unregister(this.remotePlayerId)
    this.setState('closed', reason)
  }

  on<K extends keyof VoiceTransportEvents>(ev: K, h: VoiceTransportEvents[K]): void {
    ;(this.listeners[ev] ||= []).push(h as (...a: unknown[]) => void)
  }

  off<K extends keyof VoiceTransportEvents>(ev: K, h: VoiceTransportEvents[K]): void {
    const arr = this.listeners[ev]
    if (!arr) return
    const idx = arr.indexOf(h as (...a: unknown[]) => void)
    if (idx >= 0) arr.splice(idx, 1)
  }

  private emit<K extends keyof VoiceTransportEvents>(
    ev: K,
    ...args: Parameters<VoiceTransportEvents[K]>
  ): void {
    const arr = this.listeners[ev]
    if (!arr) return
    for (const h of arr) h(...args)
  }

  private setState(s: VoiceTransportState, reason?: string): void {
    this.state = s
    this.emit('state', s, reason)
  }
}

/**
 * Helper: when multiple tier-3 transports are alive, only one of them
 * actually needs to push frames (the server broadcasts to all peers
 * anyway). Use this to dedupe.
 */
export function broadcastTier3(frame: OpusFrame): void {
  BeamMpRelayHub.get().send(frame)
}
