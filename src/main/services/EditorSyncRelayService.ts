/**
 * Host-side relay for collaborative world editing sessions.
 *
 * When a user chooses "Host" in the Session UI, this service:
 *   - binds a TCP listener on the chosen port
 *   - accepts connecting peers, issues each an authorId, sends a welcome
 *     snapshot (peer list + lastSeq)
 *   - relays every op it receives (from local bridge OR any peer) to every
 *     OTHER peer, and to the local Lua bridge (as an R| frame)
 *   - assigns monotonic `seq` + appends each op to `ops.log` (JSONL)
 *   - replays `ops.log` from `hello.fromSeq` on a late-joiner so they catch up
 *
 * Author model: the host itself is `authorId = 'host'`. Every joiner gets a
 * UUIDv4 authorId assigned at welcome time. All ops carry the originating
 * authorId so the Lua side can ignore its own echoes (Phase 2 stub: every peer
 * sees every op; echo suppression is the author comparing envelope.authorId
 * against its own).
 *
 * Per-author stacks are maintained in memory for future cascade-undo support
 * (Phase 2 item 4). The MVP just records do/undo/redo into `ops.log` and
 * broadcasts unchanged.
 */

import { createServer, type Server, type Socket } from 'net'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import {
  FrameDecoder, sendMessage,
  type SessionMessage, type OpMsg, type HelloMsg, type PoseMsg
} from './transports/SessionFrame'
import type { LuaOpEnvelope } from './EditorSyncBridgeSocket'

interface Peer {
  authorId: string
  displayName: string
  socket: Socket
  decoder: FrameDecoder
  greeted: boolean
  remote: string
}

export interface RelayStatus {
  running: boolean
  port: number
  authorId: string
  sessionId: string
  lastSeq: number
  peers: Array<{ authorId: string; displayName: string; remote: string }>
  opsLogPath: string | null
  expectedToken: boolean
}

interface Events {
  started: (status: RelayStatus) => void
  stopped: () => void
  peerJoined: (peer: { authorId: string; displayName: string; remote: string }) => void
  peerLeft: (peer: { authorId: string; reason: string }) => void
  opCommitted: (op: OpMsg) => void
  peerPose: (pose: PoseMsg) => void
}

export class EditorSyncRelayService extends EventEmitter {
  private server: Server | null = null
  private port = 0
  private peers = new Map<string, Peer>()
  private seq = 0
  private opsLogPath: string | null = null
  private sessionDir: string | null = null
  private readonly authorId = 'host'
  private sessionId = ''
  private levelName: string | null = null
  private expectedToken: string | null = null
  /** Last 512 ops kept in memory for fast late-join replay. */
  private recentOps: OpMsg[] = []
  private static readonly RECENT_CAP = 512

  override on<E extends keyof Events>(event: E, listener: Events[E]): this {
    return super.on(event, listener)
  }
  override emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean {
    return super.emit(event, ...args)
  }

  isRunning(): boolean { return this.server !== null }
  getAuthorId(): string { return this.authorId }
  getSessionId(): string { return this.sessionId }
  getPort(): number { return this.port }
  getLevelName(): string | null { return this.levelName }

  /**
   * Update the session's level name after-the-fact. Useful when the host
   * starts a session before BeamNG is running and the actual level name only
   * becomes known once the local Lua reports its first pose.
   *
   * Newly joining peers will receive this in their welcome frame; already
   * joined peers do not get a retroactive notification (their first pose
   * exchange will surface the same info).
   */
  setLevelName(name: string | null): void {
    this.levelName = name
  }

  async start(opts: {
    beamcmDir: string
    port?: number
    levelName?: string | null
    token?: string | null
  }): Promise<RelayStatus> {
    if (this.server) return this.status()
    this.sessionId = randomUUID()
    this.seq = 0
    this.peers.clear()
    this.recentOps = []
    this.levelName = opts.levelName ?? null
    this.expectedToken = opts.token ?? null

    this.sessionDir = join(opts.beamcmDir, 'session', this.sessionId.substring(0, 8))
    mkdirSync(this.sessionDir, { recursive: true })
    this.opsLogPath = join(this.sessionDir, 'ops.log')
    // Fresh log per session.
    writeFileSync(this.opsLogPath, '')

    return await new Promise<RelayStatus>((resolve, reject) => {
      const server = createServer((sock) => this.acceptPeer(sock))
      server.on('error', (err) => {
        console.error('[EditorRelay] server error', err)
      })
      server.listen(opts.port ?? 0, '0.0.0.0', () => {
        const addr = server.address()
        if (typeof addr !== 'object' || addr === null) {
          reject(new Error('EditorRelay: failed to bind'))
          return
        }
        this.server = server
        this.port = addr.port
        console.log(`[EditorRelay] listening on 0.0.0.0:${this.port} session=${this.sessionId}`)
        const st = this.status()
        this.emit('started', st)
        resolve(st)
      })
    })
  }

  stop(): void {
    if (!this.server) return
    for (const p of this.peers.values()) {
      sendMessage(p.socket, { type: 'leave', authorId: this.authorId, reason: 'host closing' })
      try { p.socket.destroy() } catch { /* ignore */ }
    }
    this.peers.clear()
    try { this.server.close() } catch { /* ignore */ }
    this.server = null
    this.port = 0
    this.sessionId = ''
    this.opsLogPath = null
    this.sessionDir = null
    this.recentOps = []
    this.emit('stopped')
  }

  status(): RelayStatus {
    return {
      running: this.server !== null,
      port: this.port,
      authorId: this.authorId,
      sessionId: this.sessionId,
      lastSeq: this.seq,
      peers: Array.from(this.peers.values()).map((p) => ({
        authorId: p.authorId,
        displayName: p.displayName,
        remote: p.remote,
      })),
      opsLogPath: this.opsLogPath,
      expectedToken: this.expectedToken !== null,
    }
  }

  /**
   * Ingest an op originating from the local Lua bridge. Assigns seq, stamps
   * authorId='host', persists, broadcasts to peers. The local Lua is NOT sent
   * its own op back (it already applied it).
   */
  ingestLocalOp(env: LuaOpEnvelope): number {
    const op: OpMsg = {
      type: 'op',
      seq: ++this.seq,
      authorId: this.authorId,
      clientOpId: env.clientOpId,
      kind: env.kind,
      name: env.name,
      data: env.data,
      detail: env.detail,
      targets: env.targets,
      ts: env.ts,
    }
    this.commitOp(op, null)
    return op.seq
  }

  /** Called by GameLauncher when a peer's op arrived; returns assigned seq. */
  private ingestPeerOp(peer: Peer, op: OpMsg): void {
    // Authoritative renumber: ignore peer-supplied seq, assign our own.
    const stamped: OpMsg = { ...op, seq: ++this.seq, authorId: peer.authorId }
    this.commitOp(stamped, peer.authorId)
    // Ack back to the originating peer so their Lua can clear inflight.
    if (op.clientOpId) {
      sendMessage(peer.socket, {
        type: 'ack', clientOpId: op.clientOpId, seq: stamped.seq, status: 'ok',
      })
    }
  }

  private commitOp(op: OpMsg, excludeAuthorId: string | null): void {
    // Persist
    if (this.opsLogPath) {
      try {
        appendFileSync(this.opsLogPath, JSON.stringify(op) + '\n')
      } catch (err) {
        console.warn('[EditorRelay] ops.log write failed', err)
      }
    }
    // In-memory ring
    this.recentOps.push(op)
    if (this.recentOps.length > EditorSyncRelayService.RECENT_CAP) {
      this.recentOps.shift()
    }
    // Broadcast to every peer except the author
    for (const p of this.peers.values()) {
      if (excludeAuthorId !== null && p.authorId === excludeAuthorId) continue
      if (!p.greeted) continue
      sendMessage(p.socket, op)
    }
    this.emit('opCommitted', op)
  }

  /** Called by the controller to forward a peer-authored op DOWN to local Lua. */
  onBroadcast(cb: (op: OpMsg) => void): void {
    this.on('opCommitted', (op) => {
      // Only forward ops that didn't originate from host's own Lua.
      if (op.authorId !== this.authorId) cb(op)
    })
  }

  /**
   * Broadcast the host's local pose to every peer. Poses are ephemeral — no
   * seq, no persistence, no ack.
   */
  broadcastLocalPose(pose: Omit<PoseMsg, 'type' | 'authorId'>): void {
    const msg: PoseMsg = { type: 'pose', authorId: this.authorId, ...pose }
    for (const p of this.peers.values()) {
      if (!p.greeted) continue
      sendMessage(p.socket, msg)
    }
  }

  /* ── Peer lifecycle ─────────────────────────────────────────────────── */

  private acceptPeer(socket: Socket): void {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`
    console.log(`[EditorRelay] peer connecting from ${remote}`)
    socket.setNoDelay(true)

    const peer: Peer = {
      authorId: '',
      displayName: '',
      socket,
      greeted: false,
      remote,
      decoder: new FrameDecoder(
        (msg) => this.handlePeerMessage(peer, msg),
        (err) => {
          console.warn(`[EditorRelay] frame error from ${remote}:`, err.message)
          try { socket.destroy() } catch { /* ignore */ }
        },
      ),
    }
    socket.on('data', (chunk) => peer.decoder.push(chunk))
    socket.on('error', (err) => {
      console.warn(`[EditorRelay] peer ${remote} error:`, err.message)
    })
    socket.on('close', () => {
      if (peer.authorId && this.peers.has(peer.authorId)) {
        this.peers.delete(peer.authorId)
        this.emit('peerLeft', { authorId: peer.authorId, reason: 'disconnect' })
        // Let everyone else know
        for (const other of this.peers.values()) {
          sendMessage(other.socket, { type: 'leave', authorId: peer.authorId, reason: 'disconnect' })
        }
      }
      console.log(`[EditorRelay] peer ${remote} disconnected`)
    })
  }

  private handlePeerMessage(peer: Peer, msg: SessionMessage): void {
    if (!peer.greeted) {
      if (msg.type !== 'hello') {
        sendMessage(peer.socket, { type: 'error', code: 'NO_HELLO', message: 'send hello first' })
        try { peer.socket.destroy() } catch { /* ignore */ }
        return
      }
      this.handleHello(peer, msg)
      return
    }
    switch (msg.type) {
      case 'op':
        this.ingestPeerOp(peer, msg)
        return
      case 'pose':
        // Stamp authoritative authorId (trust-but-verify) and rebroadcast to
        // every OTHER peer. Also surface locally so the host UI can render.
        {
          const stamped: PoseMsg = { ...msg, authorId: peer.authorId, displayName: peer.displayName }
          for (const other of this.peers.values()) {
            if (other.authorId === peer.authorId) continue
            if (!other.greeted) continue
            sendMessage(other.socket, stamped)
          }
          this.emit('peerPose', stamped)
        }
        return
      case 'ping':
        sendMessage(peer.socket, { type: 'pong', ts: msg.ts })
        return
      case 'pong':
        return
      case 'leave':
        try { peer.socket.destroy() } catch { /* ignore */ }
        return
      default:
        // Ignore unknown types (forward-compat).
        return
    }
  }

  private handleHello(peer: Peer, msg: HelloMsg): void {
    if (this.expectedToken !== null && msg.token !== this.expectedToken) {
      sendMessage(peer.socket, { type: 'error', code: 'BAD_TOKEN', message: 'invalid session token' })
      try { peer.socket.destroy() } catch { /* ignore */ }
      return
    }
    // Assign authorId — trust the client's if it looks like a UUID, else mint one.
    const isUuid = typeof msg.authorId === 'string' && /^[0-9a-f-]{36}$/i.test(msg.authorId)
    const authorId = isUuid ? msg.authorId : randomUUID()
    peer.authorId = authorId
    peer.displayName = msg.displayName || `peer-${authorId.substring(0, 6)}`
    peer.greeted = true
    this.peers.set(authorId, peer)

    // Send welcome
    sendMessage(peer.socket, {
      type: 'welcome',
      authorId: this.authorId,
      yourAuthorId: authorId,
      peers: Array.from(this.peers.values())
        .filter((p) => p.authorId !== authorId)
        .map((p) => ({ authorId: p.authorId, displayName: p.displayName })),
      lastSeq: this.seq,
      levelName: this.levelName,
    })

    // Replay recent ops (from in-memory ring) after fromSeq. This catches a
    // late-joiner up on edits that happened while they were connecting.
    const fromSeq = typeof msg.fromSeq === 'number' ? msg.fromSeq : 0
    // Disk-backed replay: if fromSeq is older than the ring head, read ops.log.
    if (fromSeq < (this.recentOps[0]?.seq ?? this.seq + 1) - 1) {
      this.replayFromDisk(peer, fromSeq)
    } else {
      for (const op of this.recentOps) {
        if (op.seq > fromSeq) sendMessage(peer.socket, op)
      }
    }

    console.log(`[EditorRelay] peer ${peer.remote} joined as ${authorId} (${peer.displayName})`)
    this.emit('peerJoined', { authorId, displayName: peer.displayName, remote: peer.remote })
    // Cross-peer presence is derived from welcome.peers + disconnect `leave`
    // frames; formal `join` announcements can be added later if needed.
  }

  private replayFromDisk(peer: Peer, fromSeq: number): void {
    if (!this.opsLogPath || !existsSync(this.opsLogPath)) return
    try {
      const raw = readFileSync(this.opsLogPath, 'utf-8')
      let count = 0
      for (const line of raw.split('\n')) {
        if (!line) continue
        try {
          const op = JSON.parse(line) as OpMsg
          if (op.type === 'op' && op.seq > fromSeq) {
            sendMessage(peer.socket, op)
            count++
          }
        } catch { /* malformed line — skip */ }
      }
      console.log(`[EditorRelay] replayed ${count} op(s) from disk to ${peer.authorId}`)
    } catch (err) {
      console.warn('[EditorRelay] replay from disk failed', err)
    }
  }
}
