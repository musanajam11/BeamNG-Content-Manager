import {
  OpusFrame,
  VOICE_CODEC,
  VoiceTier,
  VoiceTransport,
  VoiceTransportEvents,
  VoiceTransportState,
} from './types'
import { CONTROL_PREFIX, MeshTransportHub } from './MeshTransportHub'

/**
 * Tier 2 — Mesh Direct.
 *
 * One CM ↔ one CM TCP connection. Direction (who connects to whom) is decided
 * by the caller via the `role` option ('initiator' or 'acceptor'). The
 * acceptor only registers for inbound frames; the initiator additionally
 * issues a `voiceMesh:connect` to the remote `host:port` learned from the
 * mesh advertise message.
 *
 * Wire format per TCP frame (already framed by the main process):
 *   audio: [seqHi(1B)][seqLo(1B)] [opus bytes...]
 *   control: [0xFE] [json bytes...]    ← e.g. heartbeat
 */

export interface MeshDirectOpts {
  /** Peer identifier (string form of remote BeamMP playerId or `super:N`). */
  peerId: string
  /** Numeric remote player id (for the abstract VoiceTransport interface). */
  remotePlayerId: number
  /** Initiator opens the TCP connection; acceptor waits for inbound. */
  role: 'initiator' | 'acceptor'
  /** Required for initiators only — remote host:port. */
  remote?: { host: string; port: number }
}

export class MeshDirectTransport implements VoiceTransport {
  readonly tier = VoiceTier.Mesh
  readonly remotePlayerId: number
  state: VoiceTransportState = 'idle'
  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  private hub = MeshTransportHub.get()
  private sub: ReturnType<MeshTransportHub['registerPeer']>
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private lastInboundAt = 0
  private readonly idleTimeoutMs = 8000

  constructor(private opts: MeshDirectOpts) {
    this.remotePlayerId = opts.remotePlayerId
    this.sub = this.hub.registerPeer(opts.peerId)
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

  async start(): Promise<void> {
    if (this.state !== 'idle') return
    this.setState('connecting')

    this.sub.onData.add(this.onData)
    this.sub.onState.add(this.onSocketState)

    await this.hub.ensureListening()

    if (this.opts.role === 'initiator') {
      if (!this.opts.remote) {
        this.fail('initiator without remote address')
        return
      }
      const r = await this.hub.connect(
        this.opts.peerId,
        this.opts.remote.host,
        this.opts.remote.port,
      )
      if (!r.success) {
        this.fail(r.error ?? 'connect failed')
        return
      }
      // setState('open') will fire from onSocketState
    }

    // For the acceptor, the inbound socket arrival is what flips us to open.
    this.lastInboundAt = Date.now()
    this.heartbeatInterval = setInterval(() => this.tick(), 2000)
  }

  send(frame: OpusFrame): void {
    if (this.state !== 'connected') return
    if (frame.data.byteLength === 0) return
    const out = new Uint8Array(2 + frame.data.byteLength)
    out[0] = (frame.seq >>> 8) & 0xff
    out[1] = frame.seq & 0xff
    out.set(new Uint8Array(frame.data), 2)
    void this.hub.sendRaw(this.opts.peerId, out)
  }

  close(reason?: string): void {
    if (this.state === 'closed') return
    this.sub.onData.delete(this.onData)
    this.sub.onState.delete(this.onSocketState)
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    this.hub.unregisterPeer(this.opts.peerId)
    void this.hub.disconnect(this.opts.peerId)
    this.setState('closed', reason)
  }

  getState(): VoiceTransportState {
    return this.state
  }

  // ── private ──

  private onData = (data: Uint8Array): void => {
    this.lastInboundAt = Date.now()
    if (data.length === 0) return
    if (data[0] === CONTROL_PREFIX) {
      // control message — heartbeat for now
      return
    }
    if (data.length < 2) return
    const seq = (data[0] << 8) | data[1]
    const opus = data.slice(2)
    const frame: OpusFrame = {
      data: opus,
      seq,
      timestampUs: (seq * VOICE_CODEC.frameMs * 1000) | 0,
    }
    this.emit('frame', frame)
  }

  private onSocketState = (
    state: 'connecting' | 'open' | 'closed' | 'error',
    reason?: string,
  ): void => {
    if (state === 'open') {
      this.setState('connected')
    } else if (state === 'closed' || state === 'error') {
      this.setState('failed', reason ?? state)
    }
  }

  private tick(): void {
    if (this.state !== 'connected') return
    if (Date.now() - this.lastInboundAt > this.idleTimeoutMs) {
      this.fail('mesh peer idle timeout')
      return
    }
    // Heartbeat: 2-byte control payload.
    const hb = new Uint8Array([CONTROL_PREFIX, 0x00])
    void this.hub.sendRaw(this.opts.peerId, hb)
  }

  private fail(reason: string): void {
    this.setState('failed', reason)
  }

  private setState(s: VoiceTransportState, reason?: string): void {
    if (this.state === s) return
    this.state = s
    this.emit('state', s, reason)
  }
}
