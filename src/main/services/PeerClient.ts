/**
 * Joiner-side TCP client that connects to a remote CM host running
 * `EditorSyncRelayService`. Bidirectional length-prefixed JSON frames.
 *
 * Lifecycle:
 *   connect() → hello → receive welcome → ready
 *   sendOp(env) while ready
 *   on('remoteOp') fires for ops authored by other peers or the host
 *   on('ack') fires for our sent ops
 *   on('leave') when host or another peer drops
 *   disconnect() / close from peer triggers 'closed'
 *
 * Auto-reconnect is intentionally NOT implemented here — Phase 4 will layer a
 * reconnecting wrapper with seq-resume. For now a drop ends the session; user
 * re-joins via the UI.
 */

import { createConnection, type Socket } from 'net'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import {
  FrameDecoder, sendMessage, setSocketCodec,
  WIRE_PROTOCOL_VERSION,
  type SessionMessage, type OpMsg, type WelcomeMsg, type PoseMsg, type EnvMsg, type FieldMsg,
  type SnapshotBeginMsg, type SnapshotChunkMsg, type SnapshotEndMsg, type SnapshotAppliedMsg,
  type BrushMsg, type WelcomeProjectInfo, type Tier4Capability,
  type ModOfferMsg, type ModChunkMsg, type ModEndMsg,
} from './transports/SessionFrame'

/**
 * Default Tier 4 capabilities advertised by this CM build. Joiners send these
 * to the host so the host can accept / reject based on its `tier4Required`
 * list. Since every recent CM supports every Tier 4 channel (behind flags),
 * we advertise the full set and let the host decide.
 *
 * \u00a7E.32 \u2014 `'msgpack'` is purely an encoding optimisation; the host folds
 * it into its `tier4Optional` list and switches the per-peer codec when
 * both sides advertise it. JSON remains the wire-compatible fallback.
 */
const DEFAULT_TIER4_CAPABILITIES: Tier4Capability[] = [
  'reflectiveFields',
  'fullSnapshot',
  'modInventory',
  'terrainForest',
  'msgpack',
]

export interface PeerClientConfig {
  host: string
  port: number
  token?: string
  displayName?: string
  /** If set, re-use this authorId across reconnects (Phase 4). */
  authorId?: string
  /** If set, ask host to replay ops from this seq onward (late-join catchup). */
  fromSeq?: number
  /**
   * Tier 4 capabilities this joiner's CM supports. Sent in Hello so the host
   * can reject early if it has incompatible `tier4Required` capabilities.
   * Default: all four (this CM always supports everything it can speak).
   */
  tier4Capabilities?: Tier4Capability[]
  /** CM version string — shown in logs and the update-required modal. */
  cmVersion?: string
}

interface Events {
  ready: (welcome: WelcomeMsg) => void
  remoteOp: (op: OpMsg) => void
  remotePose: (pose: PoseMsg) => void
  /** A peer (or the host) updated a scene-globals key (Phase 1 env channel). */
  remoteEnv: (env: EnvMsg) => void
  /** A peer (or the host) wrote a per-object field (Phase 2 field channel). */
  remoteField: (field: FieldMsg) => void
  /** Phase 3: host is starting to ship us a snapshot. */
  snapshotBegin: (msg: SnapshotBeginMsg) => void
  /** Phase 3: one chunk of an in-flight snapshot. */
  snapshotChunk: (msg: SnapshotChunkMsg) => void
  /** Phase 3: host has finished shipping snapshot chunks. */
  snapshotEnd: (msg: SnapshotEndMsg) => void
  /** Phase 4: a brush stroke frame from a peer (begin/tick/end). */
  remoteBrush: (brush: BrushMsg) => void
  /** Host pushed a new/updated project offer mid-session. */
  projectOffered: (info: WelcomeProjectInfo) => void
  /** Tier 4 Phase 3: host responded to a `MissingModsRequest` with download coords. */
  modOffer: (offer: ModOfferMsg) => void
  /** §E.33: one slice of a TCP-fallback mod transfer (`sendModRequest`). */
  modChunk: (chunk: ModChunkMsg) => void
  /** §E.33: TCP-fallback mod transfer finished (success or error). */
  modEnd: (msg: ModEndMsg) => void
  ack: (info: { clientOpId: string; seq: number; status: string }) => void
  peerLeft: (info: { authorId: string; reason?: string }) => void
  closed: (reason: string) => void
  error: (err: Error) => void
}

export class PeerClient extends EventEmitter {
  private socket: Socket | null = null
  private decoder: FrameDecoder | null = null
  private ready = false
  private authorId = ''
  private hostAuthorId = ''
  private lastSeq = 0
  private pingTimer: NodeJS.Timeout | null = null
  private static readonly PING_INTERVAL_MS = 5000

  override on<E extends keyof Events>(event: E, listener: Events[E]): this {
    return super.on(event, listener)
  }
  override emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean {
    return super.emit(event, ...args)
  }

  isReady(): boolean { return this.ready }
  getAuthorId(): string { return this.authorId }
  getHostAuthorId(): string { return this.hostAuthorId }
  getLastSeq(): number { return this.lastSeq }

  connect(cfg: PeerClientConfig): Promise<WelcomeMsg> {
    if (this.socket) throw new Error('PeerClient: already connected')
    this.authorId = cfg.authorId || randomUUID()

    return new Promise<WelcomeMsg>((resolve, reject) => {
      // Two distinct phases, each with its own timeout, so a stuck connection
      // produces an actionable error instead of hanging on the OS-default
      // ~75 s SYN retry budget. Tailscale specifically can take several
      // seconds to set up the route on the very first connection, so we
      // intentionally leave generous headroom.
      const CONNECT_TIMEOUT_MS = 12_000  // TCP SYN + ACK
      const WELCOME_TIMEOUT_MS = 8_000   // host → 'welcome' frame after TCP up
      let phaseTimer: ReturnType<typeof setTimeout> | null = null
      let settled = false
      let socket: ReturnType<typeof createConnection>
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        if (phaseTimer) { clearTimeout(phaseTimer); phaseTimer = null }
        this.cleanup()
        reject(err)
      }
      const armTimer = (ms: number, label: string): void => {
        if (phaseTimer) clearTimeout(phaseTimer)
        phaseTimer = setTimeout(() => {
          fail(new Error(label))
          try { socket.destroy() } catch { /* ignore */ }
        }, ms)
      }

      socket = createConnection({ host: cfg.host, port: cfg.port }, () => {
        socket.setNoDelay(true)
        sendMessage(socket, {
          type: 'hello',
          protocol: WIRE_PROTOCOL_VERSION,
          authorId: this.authorId,
          displayName: cfg.displayName,
          token: cfg.token,
          fromSeq: cfg.fromSeq,
          tier4Capabilities: cfg.tier4Capabilities ?? DEFAULT_TIER4_CAPABILITIES,
          cmVersion: cfg.cmVersion,
        })
        // TCP up — now we wait for the host to reply with a welcome frame.
        armTimer(WELCOME_TIMEOUT_MS, 'no welcome from host within 8s (token rejected? wrong port? host crashed?)')
      })
      this.socket = socket
      armTimer(CONNECT_TIMEOUT_MS, `connect timed out after 12s — host unreachable at ${cfg.host}:${cfg.port} (firewall? Tailscale not routing? wrong invite code?)`)

      this.decoder = new FrameDecoder(
        (msg) => {
          if (!this.ready) {
            if (msg.type === 'welcome') {
              this.ready = true
              this.hostAuthorId = msg.authorId
              this.authorId = msg.yourAuthorId
              this.lastSeq = msg.lastSeq
              // §E.32 — if both sides agreed on `'msgpack'` (we always
              // advertise it; host echoes via tier4Optional), switch
              // our outbound encoder. Decoder auto-detects per frame.
              const optSet = new Set(msg.tier4Optional ?? [])
              const wantMsgpack =
                (cfg.tier4Capabilities ?? DEFAULT_TIER4_CAPABILITIES).includes('msgpack') &&
                optSet.has('msgpack')
              if (wantMsgpack) {
                setSocketCodec(socket, 'msgpack')
              }
              settled = true
              if (phaseTimer) { clearTimeout(phaseTimer); phaseTimer = null }
              this.startPing()
              this.emit('ready', msg)
              resolve(msg)
              return
            }
            if (msg.type === 'error') {
              fail(new Error(`${msg.code}: ${msg.message}`))
              try { socket.destroy() } catch { /* ignore */ }
              return
            }
            // Ignore other pre-welcome frames.
            return
          }
          this.dispatch(msg)
        },
        (err) => {
          if (!settled) fail(err)
          this.emit('error', err)
          try { socket.destroy() } catch { /* ignore */ }
        },
      )
      socket.on('data', (chunk) => this.decoder?.push(chunk))
      socket.on('error', (err) => {
        if (!settled) fail(err)
        this.emit('error', err)
      })
      socket.on('close', () => {
        if (phaseTimer) { clearTimeout(phaseTimer); phaseTimer = null }
        this.cleanup()
        this.emit('closed', 'peer closed')
        if (!settled) reject(new Error('socket closed before welcome'))
      })
    })
  }

  disconnect(): void {
    if (this.socket) {
      sendMessage(this.socket, { type: 'leave', authorId: this.authorId, reason: 'user' })
      try { this.socket.destroy() } catch { /* ignore */ }
    }
    this.cleanup()
  }

  /** Send an op envelope to the host. No-op if not ready. */
  sendOp(env: {
    kind: 'do' | 'undo' | 'redo'
    clientOpId: string
    name?: string
    data?: unknown
    detail?: string
    targets?: unknown[]
    ts?: number
  }): boolean {
    if (!this.socket || !this.ready) return false
    return sendMessage(this.socket, {
      type: 'op',
      seq: 0,                    // host ignores; will renumber
      authorId: this.authorId,
      clientOpId: env.clientOpId,
      kind: env.kind,
      name: env.name,
      data: env.data,
      detail: env.detail,
      targets: env.targets,
      ts: env.ts,
    })
  }

  /** Send an ephemeral pose update to the host, which rebroadcasts. */
  sendPose(pose: Omit<PoseMsg, 'type' | 'authorId'>): boolean {
    if (!this.socket || !this.ready) return false
    return sendMessage(this.socket, { type: 'pose', authorId: this.authorId, ...pose })
  }

  /**
   * Send a single env-channel observation to the host. Author + ts are
   * stamped here; host re-stamps authorId for trust-but-verify and applies
   * LWW before broadcasting. Best-effort — dropped if not ready.
   */
  sendEnv(obs: { key: string; value: unknown; ts: number }): boolean {
    if (!this.socket || !this.ready) return false
    const env: EnvMsg = {
      type: 'env',
      authorId: this.authorId,
      ts: obs.ts,
      key: obs.key,
      value: obs.value,
    }
    return sendMessage(this.socket, env)
  }

  /**
   * Send a single field-channel write to the host. Same trust model as env
   * — host re-stamps authorId and applies LWW before broadcasting.
   */
  sendField(obs: {
    pid: string; fieldName: string; arrayIndex?: number; value: unknown; ts: number
  }): boolean {
    if (!this.socket || !this.ready) return false
    const field: FieldMsg = {
      type: 'field',
      authorId: this.authorId,
      ts: obs.ts,
      pid: obs.pid,
      fieldName: obs.fieldName,
      arrayIndex: obs.arrayIndex ?? 0,
      value: obs.value,
    }
    return sendMessage(this.socket, field)
  }

  /** Phase 3: tell the host our local Lua applied (or failed to apply) a snapshot. */
  sendSnapshotApplied(snapshotId: string, ok: boolean, error?: string): boolean {
    if (!this.socket) return false
    const msg: SnapshotAppliedMsg = { type: 'snapshotApplied', snapshotId, ok, error }
    return sendMessage(this.socket, msg)
  }

  /**
   * Tier 4 Phase 3: ask the host to provide download coordinates for the
   * given manifest ids. Host responds with one `ModOffer` per id.
   */
  sendMissingModsRequest(ids: string[]): boolean {
    if (!this.socket || !this.ready || ids.length === 0) return false
    return sendMessage(this.socket, {
      type: 'missingModsRequest',
      authorId: this.authorId,
      ids,
    })
  }

  /**
   * Tier 4 Phase 3: confirm to the host that we've downloaded + staged
   * every mod we needed. Host uses this as the gate-open signal for the
   * level-load + snapshot push.
   */
  sendModsInstalled(presentIds: string[], disabledIds: string[]): boolean {
    if (!this.socket || !this.ready) return false
    return sendMessage(this.socket, {
      type: 'modsInstalled',
      authorId: this.authorId,
      presentIds,
      disabledIds,
    })
  }

  /**
   * §E.33 — ask the host to stream mod bytes for `id` over the existing
   * session TCP socket. Used as a fallback when the joiner can't reach
   * the host's HTTP mod-share route (e.g. firewall blocks adjacent ports).
   * Bytes arrive as `modChunk` events; the transfer ends with `modEnd`.
   */
  sendModRequest(id: string): boolean {
    if (!this.socket || !this.ready) return false
    return sendMessage(this.socket, {
      type: 'modRequest',
      authorId: this.authorId,
      id,
    })
  }

  /** Phase 4: send one brush stroke frame to the host. */
  sendBrush(obs: {
    strokeId: string; brushType: string; kind: 'begin' | 'tick' | 'end'; payload: unknown; ts: number
  }): boolean {
    if (!this.socket || !this.ready) return false
    const msg: BrushMsg = {
      type: 'brush',
      authorId: this.authorId,
      ts: obs.ts,
      strokeId: obs.strokeId,
      kind: obs.kind,
      brushType: obs.brushType,
      payload: obs.payload,
    }
    return sendMessage(this.socket, msg)
  }

  private dispatch(msg: SessionMessage): void {
    switch (msg.type) {
      case 'op':
        if (msg.seq > this.lastSeq) this.lastSeq = msg.seq
        this.emit('remoteOp', msg)
        return
      case 'pose':
        this.emit('remotePose', msg)
        return
      case 'env':
        this.emit('remoteEnv', msg)
        return
      case 'field':
        this.emit('remoteField', msg)
        return
      case 'snapshotBegin':
        this.emit('snapshotBegin', msg)
        return
      case 'snapshotChunk':
        this.emit('snapshotChunk', msg)
        return
      case 'snapshotEnd':
        this.emit('snapshotEnd', msg)
        return
      case 'brush':
        this.emit('remoteBrush', msg)
        return
      case 'projectOffer':
        this.emit('projectOffered', msg.project)
        return
      case 'modOffer':
        this.emit('modOffer', msg)
        return
      case 'modChunk':
        this.emit('modChunk', msg)
        return
      case 'modEnd':
        this.emit('modEnd', msg)
        return
      case 'ack':
        this.emit('ack', { clientOpId: msg.clientOpId, seq: msg.seq, status: msg.status })
        return
      case 'leave':
        this.emit('peerLeft', { authorId: msg.authorId, reason: msg.reason })
        return
      case 'ping':
        sendMessage(this.socket, { type: 'pong', ts: msg.ts })
        return
      case 'pong':
        return
      case 'error':
        this.emit('error', new Error(`${msg.code}: ${msg.message}`))
        return
      default:
        return
    }
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (this.socket && this.ready) {
        sendMessage(this.socket, { type: 'ping', ts: Date.now() })
      }
    }, PeerClient.PING_INTERVAL_MS)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private cleanup(): void {
    this.stopPing()
    this.ready = false
    this.decoder = null
    this.socket = null
  }
}
