/**
 * Tier 1 transport — direct WebRTC P2P using an RTCDataChannel for raw
 * Opus frames. We deliberately do NOT use addTrack / browser audio:
 * keeping the same Opus codec and frame size across all tiers means the
 * receiver can plug any transport into the JitterBuffer unchanged.
 *
 * Signaling (offer/answer/ICE) is delegated to the surrounding router
 * via constructor callbacks — the transport itself doesn't know about
 * IPC. This lets the router multiplex signals across tier 1, tier 2, and
 * tier 3 over the same `voice:signal` channel.
 *
 * Wire format on the data channel (binary):
 *   bytes 0-1 : seq (uint16 BE)
 *   bytes 2+  : Opus payload
 */

import {
  OpusFrame,
  VoiceTier,
  VoiceTransport,
  VoiceTransportEvents,
  VoiceTransportState,
  VOICE_CODEC,
} from './types'

export interface WebRtcSignal {
  type: 'offer' | 'answer' | 'ice'
  data: RTCSessionDescriptionInit | RTCIceCandidateInit | null
}

export interface WebRtcTransportOptions {
  remotePlayerId: number
  /** Whether this side is "polite" in the Perfect Negotiation pattern. */
  polite: boolean
  iceServers: RTCIceServer[]
  /** Called by the transport when it needs to send a signal to the remote. */
  sendSignal: (s: WebRtcSignal) => void
  /**
   * Optional connect timeout in ms. If the data channel hasn't opened by
   * then the transport transitions to 'failed' so the router can demote.
   * Default: 8000.
   */
  connectTimeoutMs?: number
}

export class WebRtcTransport implements VoiceTransport {
  readonly tier = VoiceTier.Direct
  readonly remotePlayerId: number
  state: VoiceTransportState = 'idle'

  private pc: RTCPeerConnection
  private dc: RTCDataChannel | null = null
  private polite: boolean
  private makingOffer = false
  private ignoreOffer = false
  private isImpolite: boolean
  private sendSignalCb: (s: WebRtcSignal) => void
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimeoutMs: number
  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {}

  constructor(opts: WebRtcTransportOptions) {
    this.remotePlayerId = opts.remotePlayerId
    this.polite = opts.polite
    this.isImpolite = !opts.polite
    this.sendSignalCb = opts.sendSignal
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 8000

    this.pc = new RTCPeerConnection({ iceServers: opts.iceServers })
    this.wirePc()
  }

  private wirePc(): void {
    this.pc.onicecandidate = (ev): void => {
      if (ev.candidate) {
        this.sendSignalCb({ type: 'ice', data: ev.candidate.toJSON() })
      }
    }

    this.pc.onnegotiationneeded = async (): Promise<void> => {
      try {
        this.makingOffer = true
        await this.pc.setLocalDescription()
        this.sendSignalCb({ type: 'offer', data: this.pc.localDescription?.toJSON() ?? null })
      } catch (e) {
        console.warn('[WebRtcTransport] negotiation error', e)
      } finally {
        this.makingOffer = false
      }
    }

    this.pc.onconnectionstatechange = (): void => {
      const s = this.pc.connectionState
      if (s === 'connected') {
        this.clearConnectTimer()
        // Note: state goes to 'connected' only when DC also opens.
      } else if (s === 'failed') {
        this.setState('failed', 'pc connection failed')
      } else if (s === 'closed') {
        this.setState('closed', 'pc closed')
      }
    }

    this.pc.oniceconnectionstatechange = (): void => {
      if (this.pc.iceConnectionState === 'failed') {
        try {
          this.pc.restartIce()
        } catch {
          /* ignore */
        }
      }
    }

    this.pc.ondatachannel = (ev): void => {
      this.attachDataChannel(ev.channel)
    }
  }

  private attachDataChannel(dc: RTCDataChannel): void {
    this.dc = dc
    dc.binaryType = 'arraybuffer'
    dc.onopen = (): void => {
      this.clearConnectTimer()
      this.setState('connected', 'datachannel open')
    }
    dc.onclose = (): void => {
      if (this.state === 'connected') {
        this.setState('failed', 'datachannel closed')
      }
    }
    dc.onerror = (): void => {
      this.setState('failed', 'datachannel error')
    }
    dc.onmessage = (ev: MessageEvent<ArrayBuffer>): void => {
      const buf = new Uint8Array(ev.data)
      if (buf.length < 3) return
      const seq = (buf[0] << 8) | buf[1]
      const data = new Uint8Array(buf.buffer, buf.byteOffset + 2, buf.length - 2).slice()
      this.emit('frame', {
        data,
        seq,
        timestampUs: seq * VOICE_CODEC.frameMs * 1000,
      })
    }
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return
    this.setState('connecting')
    // Impolite side opens the data channel (which also fires
    // negotiationneeded). Polite side waits for ondatachannel.
    if (this.isImpolite) {
      const dc = this.pc.createDataChannel('voice', {
        ordered: false,
        maxRetransmits: 0,
      })
      this.attachDataChannel(dc)
    }
    this.connectTimer = setTimeout(() => {
      if (this.state !== 'connected') {
        this.setState('failed', `connect timeout ${this.connectTimeoutMs}ms`)
      }
    }, this.connectTimeoutMs)
  }

  /** Inject an inbound signal received via the external signaling channel. */
  async handleSignal(s: WebRtcSignal): Promise<void> {
    if (this.state === 'closed' || this.state === 'failed') return
    try {
      if (s.type === 'offer' || s.type === 'answer') {
        const desc = s.data as RTCSessionDescriptionInit
        const offerCollision = desc.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable')
        this.ignoreOffer = !this.polite && offerCollision
        if (this.ignoreOffer) return
        await this.pc.setRemoteDescription(desc)
        if (desc.type === 'offer') {
          await this.pc.setLocalDescription()
          this.sendSignalCb({ type: 'answer', data: this.pc.localDescription?.toJSON() ?? null })
        }
      } else if (s.type === 'ice') {
        try {
          await this.pc.addIceCandidate(s.data as RTCIceCandidateInit)
        } catch (e) {
          if (!this.ignoreOffer) throw e
        }
      }
    } catch (e) {
      console.warn('[WebRtcTransport] handleSignal error', e)
    }
  }

  send(frame: OpusFrame): void {
    if (this.state !== 'connected' || !this.dc || this.dc.readyState !== 'open') return
    // Backpressure: drop if buffered amount > 5 frames worth (~1.5kB).
    if (this.dc.bufferedAmount > 1500) {
      this.emit('backpressure', this.dc.bufferedAmount)
      return
    }
    const out = new Uint8Array(2 + frame.data.length)
    out[0] = (frame.seq >> 8) & 0xff
    out[1] = frame.seq & 0xff
    out.set(frame.data, 2)
    try {
      this.dc.send(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength))
    } catch (e) {
      console.warn('[WebRtcTransport] send error', e)
    }
  }

  close(reason?: string): void {
    if (this.state === 'closed') return
    this.clearConnectTimer()
    try {
      this.dc?.close()
    } catch {
      /* ignore */
    }
    try {
      this.pc.close()
    } catch {
      /* ignore */
    }
    this.dc = null
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
    if (this.state === s) return
    this.state = s
    this.emit('state', s, reason)
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }
}
