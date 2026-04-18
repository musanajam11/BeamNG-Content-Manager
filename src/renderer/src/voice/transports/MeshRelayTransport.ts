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
 * Tier 2 — Mesh Relay (via supernode).
 *
 * Used when neither end can establish a direct CM↔CM TCP connection (both
 * symmetric NAT) but a third reachable peer in the session can act as a
 * supernode. The supernode is wired up via MeshDirectTransport using a
 * special pseudo-peerId of `super:<supernodeId>`. This transport piggybacks
 * on that single TCP connection and tags every payload with a destination
 * playerId so the supernode can route it.
 *
 * Wire format (post-prefix):
 *   audio:   [0xA1] [seqHi(1B)] [seqLo(1B)] [srcIdLE(4B)] [dstIdLE(4B)] [opus...]
 *   control: [0xFE] [json bytes...]    ← already handled by direct hub
 *
 * The supernode runs the same MeshTransportHub; on receiving a 0xA1 payload
 * with dstId != self, it forwards the bytes verbatim to the dst's mesh
 * socket. srcId allows the destination to demux audio per source peer when
 * multiple peers are routing through the same supernode socket.
 * That logic is implemented in the renderer-side MeshSupernode (see
 * MeshElection.ts).
 */

const RELAY_PREFIX = 0xa1
/** Wire header length: prefix(1) + seq(2) + srcId(4) + dstId(4). */
const RELAY_HDR_LEN = 11

export interface MeshRelayOpts {
  /** Final destination peer (string form of remote BeamMP playerId). */
  dstPeerId: string
  /** PeerId we use for the supernode TCP connection. */
  supernodePeerId: string
  /** Local player id, embedded in outbound relay frames. */
  selfId: number
  /** The remote player id (parsed numeric form of dstPeerId). */
  dstId: number
}

export class MeshRelayTransport implements VoiceTransport {
  readonly tier = VoiceTier.Mesh
  readonly remotePlayerId: number
  state: VoiceTransportState = 'idle'
  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  private hub = MeshTransportHub.get()
  private superSub: ReturnType<MeshTransportHub['registerPeer']>
  private idleTimer: ReturnType<typeof setInterval> | null = null
  private lastInboundAt = 0
  private readonly idleTimeoutMs = 10000

  constructor(private opts: MeshRelayOpts) {
    this.remotePlayerId = opts.dstId
    this.superSub = this.hub.registerPeer(opts.supernodePeerId)
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
    await this.hub.ensureListening()

    // The MeshDirectTransport for the supernode connection is created
    // separately by the orchestrator; here we only attach to its inbound
    // stream and assume it is (or will become) open.
    this.superSub.onData.add(this.onData)
    this.superSub.onState.add(this.onSocketState)

    this.lastInboundAt = Date.now()
    this.idleTimer = setInterval(() => this.tick(), 2000)

    // Optimistically mark connected; tick() will demote on idle timeout.
    this.setState('connected')
  }

  send(frame: OpusFrame): void {
    if (this.state !== 'connected') return
    if (frame.data.byteLength === 0) return
    const out = new Uint8Array(RELAY_HDR_LEN + frame.data.byteLength)
    out[0] = RELAY_PREFIX
    out[1] = (frame.seq >>> 8) & 0xff
    out[2] = frame.seq & 0xff
    const view = new DataView(out.buffer)
    // Source playerId (so receiver can demux per remote), little-endian uint32.
    view.setUint32(3, this.opts.selfId >>> 0, true)
    // Destination playerId, little-endian uint32.
    view.setUint32(7, this.opts.dstId >>> 0, true)
    out.set(new Uint8Array(frame.data), RELAY_HDR_LEN)
    void this.hub.sendRaw(this.opts.supernodePeerId, out)
  }

  close(reason?: string): void {
    if (this.state === 'closed') return
    this.superSub.onData.delete(this.onData)
    this.superSub.onState.delete(this.onSocketState)
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
    this.setState('closed', reason)
  }

  getState(): VoiceTransportState {
    return this.state
  }

  private onData = (data: Uint8Array): void => {
    if (data.length < RELAY_HDR_LEN) return
    if (data[0] !== RELAY_PREFIX) return // not a relay frame (e.g. control)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const srcId = view.getUint32(3, true)
    const dstId = view.getUint32(7, true)
    if (dstId !== this.opts.selfId) return // routed to a different peer
    if (srcId !== this.opts.dstId) return // from a different source peer
    const seq = (data[1] << 8) | data[2]
    const opus = data.slice(RELAY_HDR_LEN)
    this.lastInboundAt = Date.now()
    this.emit('frame', {
      data: opus,
      seq,
      timestampUs: (seq * VOICE_CODEC.frameMs * 1000) | 0,
    })
  }

  private onSocketState = (
    state: 'connecting' | 'open' | 'closed' | 'error',
    reason?: string,
  ): void => {
    if (state === 'closed' || state === 'error') {
      this.setState('failed', reason ?? state)
    }
  }

  private tick(): void {
    if (this.state !== 'connected') return
    if (Date.now() - this.lastInboundAt > this.idleTimeoutMs) {
      this.setState('failed', 'relay idle timeout')
      return
    }
    const hb = new Uint8Array([CONTROL_PREFIX, 0x01])
    void this.hub.sendRaw(this.opts.supernodePeerId, hb)
  }

  private setState(s: VoiceTransportState, reason?: string): void {
    if (this.state === s) return
    this.state = s
    this.emit('state', s, reason)
  }
}

export { RELAY_PREFIX, RELAY_HDR_LEN }
