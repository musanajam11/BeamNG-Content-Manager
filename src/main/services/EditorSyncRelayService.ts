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
import { createServer as createHttpServer, type Server as HttpServer } from 'http'
import { appendFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createHash, randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import archiver from 'archiver'
import {
  FrameDecoder, sendMessage,
  type SessionMessage, type OpMsg, type HelloMsg, type PoseMsg, type EnvMsg, type EnvCacheEntry, type FieldMsg,
  type SnapshotBeginMsg, type SnapshotChunkMsg, type SnapshotEndMsg, type SnapshotAppliedMsg, type BrushMsg,
  type WelcomeProjectInfo
} from './transports/SessionFrame'
import type { GameLauncherService } from './GameLauncherService'
import type { LuaOpEnvelope, LuaEnvObservation, LuaFieldObservation, LuaSnapshotChunk, LuaBrushObservation } from './EditorSyncBridgeSocket'

/**
 * Max number of snapshot rebuild+resend cycles per joiner before we give
 * up and release their gate. 3 covers transient Lua-side failures
 * (inspector busy, editor not yet active) without stalling forever.
 */
const MAX_SNAPSHOT_RETRIES = 3

interface Peer {
  authorId: string
  displayName: string
  socket: Socket
  decoder: FrameDecoder
  greeted: boolean
  remote: string
  /**
   * True between Welcome and the joiner's SnapshotApplied ack. While true,
   * we do NOT push live ops/env/field deltas to this peer — they get the
   * snapshot first, then we drain a tail of post-baseSeq deltas on top.
   */
  snapshotPending: boolean
  /** True when we've issued a build request and are awaiting the chunks. */
  snapshotInFlight: boolean
  /**
   * Number of snapshot apply attempts for this peer. Bumped each time we
   * send a snapshot; if the joiner reports `ok=false` we retry up to
   * MAX_SNAPSHOT_RETRIES before giving up (and only then releasing the
   * gate so they at least get live ops).
   */
  snapshotAttempts: number
  /** Captured between Welcome and SnapshotApplied so we can drain after ack. */
  pendingQueue: SessionMessage[]
  /**
   * Auth state machine. Mirrors the relay's configured auth mode:
   *   - open / token / friends → jumps straight to 'approved' once accepted
   *   - approval              → sits in 'pending' until host decides
   *   - rejected peers are destroyed; the 'rejected' value exists only to
   *     make debug logs readable.
   */
  authState: 'pending' | 'approved' | 'rejected'
  /** Pending-approval bookkeeping surfaced through the UI. */
  pendingHello?: {
    authorId: string
    displayName: string
    beamUsername: string | null
    fromSeq: number
    remote: string
  }
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
  authMode: RelayAuthMode
  pendingApprovals: Array<{
    authorId: string
    displayName: string
    beamUsername: string | null
    remote: string
  }>
}

/**
 * How the host authenticates incoming joiners:
 *   - `open`      — anyone who can reach the port joins (prototype / LAN only)
 *   - `token`     — shared secret, must match the host's session token
 *   - `approval`  — every joiner sits in a queue until host clicks Accept
 *   - `friends`   — joiner's `beamUsername` must appear in the whitelist
 */
export type RelayAuthMode = 'open' | 'token' | 'approval' | 'friends'

interface Events {
  started: (status: RelayStatus) => void
  stopped: () => void
  peerJoined: (peer: { authorId: string; displayName: string; remote: string }) => void
  peerLeft: (peer: { authorId: string; reason: string }) => void
  opCommitted: (op: OpMsg) => void
  peerPose: (pose: PoseMsg) => void
  /** Emitted after LWW-accept; controller forwards to local Lua. */
  envCommitted: (env: EnvMsg) => void
  /** Per-object field write accepted via LWW; controller forwards to local Lua. */
  fieldCommitted: (field: FieldMsg) => void
  /** Brush stroke frame fanned out (Phase 4); controller forwards to local Lua. */
  brushCommitted: (brush: BrushMsg) => void
  /**
   * A peer is waiting for host approval. The controller surfaces this to the
   * UI as a prompt ("Accept <name>?"). Only fires when `authMode === 'approval'`.
   */
  peerPendingApproval: (peer: {
    authorId: string
    displayName: string
    beamUsername: string | null
    remote: string
  }) => void
  /** Queue was drained (approval/rejection/disconnect). For UI refresh. */
  pendingApprovalsChanged: (count: number) => void
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
  /**
   * Random per-session bearer token embedded in every welcome/projectOffer
   * frame and required as `?token=…` on project.zip downloads.
   */
  private projectAuthToken = ''
  private levelName: string | null = null
  private expectedToken: string | null = null
  private authMode: RelayAuthMode = 'open'
  /**
   * Lowercased BeamMP usernames allowed when `authMode === 'friends'`.
   * Stored lowercase for case-insensitive comparison with the joiner's
   * `hello.beamUsername`.
   */
  private friendsWhitelist: Set<string> = new Set()
  /**
   * Peers whose sockets are open but which are stuck in `authState='pending'`
   * because `authMode==='approval'`. Keyed by `peer.authorId` after it's
   * minted in handleHello. Surfaced via `status().pendingApprovals` and
   * `peerPendingApproval` events.
   */
  private pendingApprovals = new Map<string, Peer>()
  /** Optional host-side hint about where the current level came from. */
  private levelSource: { builtIn: boolean; modPath?: string; hash?: string } | null = null
  /** Last 512 ops kept in memory for fast late-join replay. */
  private recentOps: OpMsg[] = []
  private static readonly RECENT_CAP = 512

  /**
   * Per-key env state cache (Phase 1 env channel). Last-write-wins, with
   * deterministic tiebreak on `(ts, authorId)`. Sent verbatim inside the
   * `welcome.env` payload so cold-joining peers see current ToD/weather/etc
   * without waiting for the next poll tick from anyone.
   */
  private envState = new Map<string, EnvMsg>()

  /**
   * Per-(pid, fieldName) cache (Phase 2 field channel). LWW with the same
   * tiebreak rule as env. Not sent in Welcome — the snapshot exchange
   * (Phase 3) carries it instead, since it can grow to thousands of entries.
   */
  private fieldState = new Map<string, FieldMsg>()

  /**
   * Cached most-recent snapshot built by the host Lua (Phase 3). Null until
   * the first build completes. Joiners get this verbatim before live ops.
   */
  private currentSnapshot: {
    id: string
    baseSeq: number
    byteLength: number
    total: number
    chunks: string[]   // index → payload (UTF-8 string slice)
    levelName: string | null
    createdTs: number
  } | null = null

  /**
   * In-progress snapshot assembly buffer. Lua streams chunks asynchronously;
   * we accumulate by snapshotId until `total` chunks are present, then move
   * the result into `currentSnapshot`.
   */
  private snapshotInbox = new Map<string, {
    total: number
    byteLength: number
    chunks: string[]
    levelName: string | null
    createdTs: number
    /**
     * Op `seq` captured the moment we requested the build, so live ops with
     * `seq > baseSeq` replay correctly on top after the joiner applies.
     */
    baseSeq: number
  }>()

  /** Optional: launcher hook so the relay can ask host Lua to build snapshots. */
  private gameLauncher: GameLauncherService | null = null

  /**
   * Optional: "active project" the host is offering to peers. When non-null,
   * every Welcome frame gains a `project` section advertising the HTTP URL
   * peers can `GET` the zipped project from. Populated by
   * `setActiveProject` — typically called by the session controller after
   * the renderer auto-provisions a project on launch-into-editor, or after
   * the user explicitly picks one from the host form.
   *
   * The zip is cached on disk next to the project folder (at
   * `<parent>/.<folder>.coop.zip`) so we don't hold it in memory for the
   * whole session. When a peer GETs it, we stream the file back.
   */
  private activeProject: {
    name: string
    levelName: string
    folder: string           // folder name under <userDir>/levels/_beamcm_projects/
    absDir: string           // absolute on-disk path (what we zip up)
    zipPath: string          // absolute path of the cached .zip
    sizeBytes: number        // stat of zipPath at build time
    sha256: string           // hex digest of the file
  } | null = null
  /** Secondary HTTP listener on `port + 1` for project downloads. */
  private httpServer: HttpServer | null = null
  /** Port the HTTP listener bound on. 0 when no active project / stopped. */
  private httpPort = 0

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
    authMode?: RelayAuthMode
    friendsWhitelist?: string[]
    levelSource?: { builtIn: boolean; modPath?: string; hash?: string } | null
  }): Promise<RelayStatus> {
    if (this.server) return this.status()
    this.sessionId = randomUUID()
    this.projectAuthToken = randomUUID().replace(/-/g, '')
    this.seq = 0
    this.peers.clear()
    this.recentOps = []
    this.envState.clear()
    this.fieldState.clear()
    this.pendingApprovals.clear()
    this.levelName = opts.levelName ?? null
    this.expectedToken = opts.token ?? null
    this.authMode = opts.authMode ?? (opts.token ? 'token' : 'open')
    this.friendsWhitelist = new Set(
      (opts.friendsWhitelist ?? []).map((s) => s.toLowerCase())
    )
    this.levelSource = opts.levelSource ?? null

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
    this.projectAuthToken = ''
    this.opsLogPath = null
    this.sessionDir = null
    this.recentOps = []
    this.envState.clear()
    this.fieldState.clear()
    this.stopProjectHttpServer()
    if (this.activeProject?.zipPath) {
      // Best-effort: drop the on-disk cache when the session ends. Keeps
      // the host's project folder clean; if it fails (AV lock etc.) we just
      // leave the dotfile behind, BeamNG ignores it.
      try { rmSync(this.activeProject.zipPath, { force: true }) } catch { /* ignore */ }
    }
    this.activeProject = null
    this.emit('stopped')
  }

  /**
   * Host-side: zip `<absDir>` in memory, hash it, remember it as the
   * currently-advertised project, and make sure the HTTP download listener
   * is running. Future Welcome frames will include a `project` section
   * pointing at the listener; already-connected peers get a standalone
   * notification via the session controller (out-of-band over IPC).
   *
   * Returns the metadata that will be embedded in Welcome frames.
   */
  async setActiveProject(params: {
    name: string
    levelName: string
    folder: string
    absDir: string
  }): Promise<WelcomeProjectInfo | null> {
    if (!this.server || !existsSync(params.absDir)) return null
    try {
      // Cache the zip on disk next to the project folder so we don't hold
      // tens of MB in memory for the whole session. Dotfile prefix keeps it
      // out of BeamNG's level index.
      const parentDir = join(params.absDir, '..')
      const zipPath = join(parentDir, `.${params.folder}.coop.zip`)
      mkdirSync(parentDir, { recursive: true })
      const { sha256, sizeBytes } = await this.zipDirectoryToFile(params.absDir, zipPath)
      this.activeProject = { ...params, zipPath, sha256, sizeBytes }
      await this.ensureProjectHttpServer()
      console.log(
        `[EditorRelay] active project set: "${params.name}" (${params.levelName}) — ` +
          `${sizeBytes} B → ${zipPath} · http://0.0.0.0:${this.httpPort}/project.zip`
      )
      // Mid-session push: broadcast the new offer to every already-greeted
      // peer so they can re-download if the sha256 changed. New peers pick
      // it up via their welcome frame instead.
      const info = this.getProjectWelcomeInfo()
      if (info) {
        for (const p of this.peers.values()) {
          if (!p.greeted) continue
          sendMessage(p.socket, { type: 'projectOffer', project: info })
        }
      }
      return info
    } catch (err) {
      console.warn('[EditorRelay] setActiveProject failed:', (err as Error).message)
      this.activeProject = null
      this.stopProjectHttpServer()
      return null
    }
  }

  getActiveProject(): WelcomeProjectInfo | null {
    return this.getProjectWelcomeInfo()
  }

  private getProjectWelcomeInfo(): WelcomeProjectInfo | null {
    if (!this.activeProject || this.httpPort === 0) return null
    return {
      name: this.activeProject.name,
      levelName: this.activeProject.levelName,
      folder: this.activeProject.folder,
      sha256: this.activeProject.sha256,
      sizeBytes: this.activeProject.sizeBytes,
      httpPort: this.httpPort,
      authToken: this.projectAuthToken,
    }
  }

  /**
   * Serve the cached project zip over plain HTTP. Bound to all interfaces
   * on `relayPort + 1` for simplicity — callers should extend the firewall
   * rule to cover both ports. Only `GET /project.zip` is routed; anything
   * else returns 404.
   */
  private ensureProjectHttpServer(): Promise<void> {
    if (this.httpServer) return Promise.resolve()
    const preferredPort = this.port > 0 ? this.port + 1 : 0
    return new Promise((resolve, reject) => {
      const http = createHttpServer((req, res) => {
        if (!this.activeProject) {
          res.writeHead(503, { 'content-type': 'text/plain' })
          res.end('No project available')
          return
        }
        const url = req.url || ''
        if (!req.method || req.method.toUpperCase() !== 'GET') {
          res.writeHead(405); res.end(); return
        }
        if (!url.startsWith('/project.zip')) {
          res.writeHead(404); res.end(); return
        }
        // Enforce per-session bearer token (passed as ?token=… query
        // parameter). Joiners get the token via their Welcome frame; third
        // parties on the same LAN/Tailscale network without a session seat
        // can't download the zip.
        const q = url.indexOf('?')
        const qs = q >= 0 ? url.substring(q + 1) : ''
        const params = new URLSearchParams(qs)
        const supplied = params.get('token') ?? ''
        if (!this.projectAuthToken || supplied !== this.projectAuthToken) {
          res.writeHead(401, { 'content-type': 'text/plain' })
          res.end('invalid or missing session token')
          return
        }
        const { zipPath, sha256, name, sizeBytes } = this.activeProject
        if (!existsSync(zipPath)) {
          res.writeHead(503); res.end('cache missing'); return
        }
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': String(sizeBytes),
          'content-disposition': `attachment; filename="${name}.zip"`,
          'x-project-sha256': sha256,
        })
        const stream = createReadStream(zipPath)
        stream.on('error', (err) => {
          console.warn('[EditorRelay] project zip read error:', err.message)
          try { res.destroy(err) } catch { /* ignore */ }
        })
        stream.pipe(res)
      })
      http.on('error', (err) => {
        console.warn('[EditorRelay] project HTTP server error:', err.message)
      })
      http.listen(preferredPort, '0.0.0.0', () => {
        const addr = http.address()
        if (typeof addr !== 'object' || addr === null) {
          reject(new Error('project HTTP: failed to bind'))
          return
        }
        this.httpServer = http
        this.httpPort = addr.port
        console.log(`[EditorRelay] project HTTP on 0.0.0.0:${this.httpPort}`)
        resolve()
      })
    })
  }

  private stopProjectHttpServer(): void {
    if (!this.httpServer) return
    try { this.httpServer.close() } catch { /* ignore */ }
    this.httpServer = null
    this.httpPort = 0
  }

  /**
   * Stream a directory through `archiver` into a file on disk, hashing on
   * the fly. Overwrites any previous zip at `zipPath`. Returns size + sha256.
   */
  private zipDirectoryToFile(absDir: string, zipPath: string): Promise<{ sha256: string; sizeBytes: number }> {
    return new Promise((resolve, reject) => {
      // Validate up front so a bad path surfaces a clean error instead of an
      // archiver-level warning about "no entries".
      try { statSync(absDir) } catch (e) { reject(e); return }
      const out = createWriteStream(zipPath)
      const hash = createHash('sha256')
      let size = 0
      const archive = archiver('zip', { zlib: { level: 6 } })
      archive.on('error', reject)
      archive.on('data', (c: Buffer) => { hash.update(c); size += c.length })
      out.on('error', reject)
      out.on('close', () => resolve({ sha256: hash.digest('hex'), sizeBytes: size }))
      archive.pipe(out)
      archive.directory(absDir, false)
      void archive.finalize()
    })
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
      authMode: this.authMode,
      pendingApprovals: Array.from(this.pendingApprovals.values()).map((p) => ({
        authorId: p.authorId,
        displayName: p.displayName,
        beamUsername: p.pendingHello?.beamUsername ?? null,
        remote: p.remote,
      })),
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
      if (p.snapshotPending) { p.pendingQueue.push(op); continue }
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

  /* ── Env channel (Phase 1) ──────────────────────────────────────────── */

  /**
   * Last-write-wins acceptance. Tiebreak on (ts, authorId) lexicographically
   * so two peers racing on the same key reach the same outcome without an
   * extra round trip. Returns true if the value was accepted into the cache.
   */
  private acceptEnvLww(env: EnvMsg): boolean {
    const cur = this.envState.get(env.key)
    if (cur) {
      if (env.ts < cur.ts) return false
      if (env.ts === cur.ts && env.authorId <= cur.authorId) return false
    }
    this.envState.set(env.key, env)
    return true
  }

  /**
   * Ingest an env observation captured by the host's own Lua. Author is
   * stamped 'host'; relay broadcasts to every peer (no echo back to local).
   */
  ingestLocalEnv(obs: LuaEnvObservation): void {
    const env: EnvMsg = {
      type: 'env',
      authorId: this.authorId,
      ts: obs.ts,
      key: obs.key,
      value: obs.value,
    }
    if (!this.acceptEnvLww(env)) return
    this.broadcastEnv(env, null)
  }

  /** A peer reported an env change. Trust their authorId after handshake. */
  private ingestPeerEnv(peer: Peer, msg: EnvMsg): void {
    const stamped: EnvMsg = { ...msg, authorId: peer.authorId }
    if (!this.acceptEnvLww(stamped)) return
    this.broadcastEnv(stamped, peer.authorId)
  }

  private broadcastEnv(env: EnvMsg, excludeAuthorId: string | null): void {
    for (const p of this.peers.values()) {
      if (excludeAuthorId !== null && p.authorId === excludeAuthorId) continue
      if (!p.greeted) continue
      if (p.snapshotPending) { p.pendingQueue.push(env); continue }
      sendMessage(p.socket, env)
    }
    this.emit('envCommitted', env)
  }

  /** Forward peer-authored env messages DOWN to local Lua. */
  onEnvBroadcast(cb: (env: EnvMsg) => void): void {
    this.on('envCommitted', (env) => {
      if (env.authorId !== this.authorId) cb(env)
    })
  }

  /* ── Field channel (Phase 2) ─────────────────────────────────────────── */

  /** Cache key matches Lua's `pid|fieldName` shape; arrayIndex collapsed for v1. */
  private fieldKey(pid: string, fieldName: string): string {
    return pid + '|' + fieldName
  }

  private acceptFieldLww(field: FieldMsg): boolean {
    const key = this.fieldKey(field.pid, field.fieldName)
    const cur = this.fieldState.get(key)
    if (cur) {
      if (field.ts < cur.ts) return false
      if (field.ts === cur.ts && field.authorId <= cur.authorId) return false
    }
    this.fieldState.set(key, field)
    return true
  }

  /** Local Lua reported a field write (helper or polling diff). */
  ingestLocalField(obs: LuaFieldObservation): void {
    const field: FieldMsg = {
      type: 'field',
      authorId: this.authorId,
      ts: obs.ts,
      pid: obs.pid,
      fieldName: obs.fieldName,
      arrayIndex: obs.arrayIndex ?? 0,
      value: obs.value,
    }
    if (!this.acceptFieldLww(field)) return
    this.broadcastField(field, null)
  }

  /** A peer reported a field write. */
  private ingestPeerField(peer: Peer, msg: FieldMsg): void {
    const stamped: FieldMsg = { ...msg, authorId: peer.authorId }
    if (!this.acceptFieldLww(stamped)) return
    this.broadcastField(stamped, peer.authorId)
  }

  private broadcastField(field: FieldMsg, excludeAuthorId: string | null): void {
    for (const p of this.peers.values()) {
      if (excludeAuthorId !== null && p.authorId === excludeAuthorId) continue
      if (!p.greeted) continue
      if (p.snapshotPending) { p.pendingQueue.push(field); continue }
      sendMessage(p.socket, field)
    }
    this.emit('fieldCommitted', field)
  }

  /** Forward peer-authored field writes DOWN to local Lua. */
  onFieldBroadcast(cb: (field: FieldMsg) => void): void {
    this.on('fieldCommitted', (field) => {
      if (field.authorId !== this.authorId) cb(field)
    })
  }

  /* ── Brush channel (Phase 4) ─────────────────────────────────────────── */

  /**
   * Active strokes by `strokeId`. Tracks the last frame ts so we can fire
   * a synthetic `end` if the originator disconnects mid-stroke.
   */
  private activeStrokes = new Map<string, {
    authorId: string
    brushType: string
    lastTs: number
    settings: unknown
  }>()
  private static readonly STROKE_TIMEOUT_MS = 3000
  private strokeReaperTimer: NodeJS.Timeout | null = null

  /** Local Lua reported a brush stroke frame (begin/tick/end). */
  ingestLocalBrush(obs: LuaBrushObservation): void {
    const msg: BrushMsg = {
      type: 'brush',
      authorId: this.authorId,
      ts: obs.ts,
      strokeId: obs.strokeId,
      kind: obs.kind,
      brushType: obs.brushType,
      payload: obs.payload,
    }
    this.recordStroke(msg)
    this.broadcastBrush(msg, null)
  }

  /** A peer reported a brush stroke frame. */
  private ingestPeerBrush(peer: Peer, msg: BrushMsg): void {
    const stamped: BrushMsg = { ...msg, authorId: peer.authorId }
    this.recordStroke(stamped)
    this.broadcastBrush(stamped, peer.authorId)
  }

  /** Track an active stroke so we can synth-end on disconnect. */
  private recordStroke(msg: BrushMsg): void {
    if (msg.kind === 'begin') {
      this.activeStrokes.set(msg.strokeId, {
        authorId: msg.authorId,
        brushType: msg.brushType,
        lastTs: msg.ts,
        settings: msg.payload,
      })
      this.ensureStrokeReaper()
    } else if (msg.kind === 'tick') {
      const st = this.activeStrokes.get(msg.strokeId)
      if (st) st.lastTs = msg.ts
    } else if (msg.kind === 'end') {
      this.activeStrokes.delete(msg.strokeId)
    }
  }

  private broadcastBrush(brush: BrushMsg, excludeAuthorId: string | null): void {
    for (const p of this.peers.values()) {
      if (excludeAuthorId !== null && p.authorId === excludeAuthorId) continue
      if (!p.greeted) continue
      if (p.snapshotPending) { p.pendingQueue.push(brush); continue }
      sendMessage(p.socket, brush)
    }
    this.emit('brushCommitted', brush)
  }

  /** Forward peer-authored brush frames DOWN to local Lua. */
  onBrushBroadcast(cb: (brush: BrushMsg) => void): void {
    this.on('brushCommitted', (brush) => {
      if (brush.authorId !== this.authorId) cb(brush)
    })
  }

  /**
   * Lazily start a 1 Hz timer that expires strokes whose last frame is
   * older than STROKE_TIMEOUT_MS (originator probably crashed/disconnected
   * mid-gesture). Synthesises a final `end` so peers' replay contexts close.
   */
  private ensureStrokeReaper(): void {
    if (this.strokeReaperTimer) return
    const tick = (): void => {
      const now = Date.now()
      for (const [id, st] of this.activeStrokes) {
        if (now - st.lastTs < EditorSyncRelayService.STROKE_TIMEOUT_MS) continue
        const synth: BrushMsg = {
          type: 'brush',
          authorId: st.authorId,
          ts: now,
          strokeId: id,
          kind: 'end',
          brushType: st.brushType,
          payload: { synthesized: true, reason: 'no-tick-timeout' },
        }
        this.activeStrokes.delete(id)
        this.broadcastBrush(synth, null)
      }
      if (this.activeStrokes.size === 0 && this.strokeReaperTimer) {
        clearInterval(this.strokeReaperTimer)
        this.strokeReaperTimer = null
      }
    }
    this.strokeReaperTimer = setInterval(tick, 1000)
    if (typeof this.strokeReaperTimer.unref === 'function') this.strokeReaperTimer.unref()
  }

  /* ── Snapshot exchange (Phase 3) ─────────────────────────────────────── */

  /**
   * Wire the relay to the local game launcher so it can ask host Lua to
   * build snapshots on demand. Called by SessionController during startHost.
   * Without this, snapshot exchange is disabled and joiners fall back to
   * pure replay (legacy behavior).
   */
  setGameLauncher(launcher: GameLauncherService | null): void {
    this.gameLauncher = launcher
  }

  /**
   * Ingest one snapshot chunk emitted by the host Lua (Y| frame). Buffers
   * by snapshotId until all `total` chunks arrive, then promotes to
   * `currentSnapshot` and flushes to any peer waiting for one.
   */
  ingestSnapshotChunk(chunk: LuaSnapshotChunk): void {
    let box = this.snapshotInbox.get(chunk.snapshotId)
    if (!box) {
      box = {
        total: chunk.total,
        byteLength: chunk.byteLength,
        chunks: new Array(chunk.total),
        levelName: chunk.levelName ?? null,
        createdTs: chunk.createdTs,
        // baseSeq was captured at request time; if the request map has it
        // use that, otherwise fall back to current seq (best-effort).
        baseSeq: this.pendingSnapshotRequests.get(chunk.snapshotId) ?? this.seq,
      }
      this.snapshotInbox.set(chunk.snapshotId, box)
    }
    box.chunks[chunk.index] = chunk.payload
    // Complete?
    for (let i = 0; i < box.total; i++) if (box.chunks[i] === undefined) return
    this.snapshotInbox.delete(chunk.snapshotId)
    this.pendingSnapshotRequests.delete(chunk.snapshotId)
    this.currentSnapshot = {
      id: chunk.snapshotId,
      baseSeq: box.baseSeq,
      byteLength: box.byteLength,
      total: box.total,
      chunks: box.chunks as string[],
      levelName: box.levelName,
      createdTs: box.createdTs,
    }
    console.log(`[EditorRelay] snapshot ${chunk.snapshotId.substring(0, 8)} ready (${box.total} chunks, ${box.byteLength} B, baseSeq=${box.baseSeq})`)
    this.persistSnapshotToDisk()
    this.snapshotBuildInFlight = false
    // Flush to any peer that was waiting for a snapshot.
    for (const p of this.peers.values()) {
      if (p.snapshotPending && !p.snapshotInFlight) this.sendOrBuildSnapshotFor(p)
    }
  }

  /** Outstanding `requestSnapshot` calls keyed by snapshotId → baseSeq. */
  private pendingSnapshotRequests = new Map<string, number>()

  /**
   * True while at least one snapshot build request is outstanding to Lua.
   * Prevents two concurrent joiners from each issuing their own Z|request
   * (which would trigger two redundant builds and race each other into
   * `currentSnapshot`). Cleared when chunks for the tracked request arrive
   * or when the request errors out.
   */
  private snapshotBuildInFlight = false

  /**
   * For a peer in `snapshotPending` state, either send the cached snapshot
   * if we have one, or trigger a build (and the chunks will arrive later via
   * `ingestSnapshotChunk`, which will re-call this).
   */
  private sendOrBuildSnapshotFor(peer: Peer): void {
    if (this.currentSnapshot) {
      this.sendSnapshotToPeer(peer, this.currentSnapshot)
      return
    }
    if (peer.snapshotInFlight) return
    peer.snapshotInFlight = true
    // Coalesce: if a build is already running for another peer, just wait
    // — ingestSnapshotChunk's flush-all-pending loop will wake us up when
    // the chunks arrive.
    if (this.snapshotBuildInFlight) return
    if (!this.gameLauncher) return
    const id = randomUUID()
    this.pendingSnapshotRequests.set(id, this.seq)
    this.snapshotBuildInFlight = true
    const ok = this.gameLauncher.requestEditorSnapshot(id)
    if (!ok) {
      // Lua bridge isn't up — give up gating; release the peer ungated.
      this.pendingSnapshotRequests.delete(id)
      this.snapshotBuildInFlight = false
      peer.snapshotInFlight = false
      peer.snapshotPending = false
      this.flushPendingQueue(peer)
    }
  }

  private sendSnapshotToPeer(peer: Peer, snap: NonNullable<EditorSyncRelayService['currentSnapshot']>): void {
    peer.snapshotAttempts += 1
    const begin: SnapshotBeginMsg = {
      type: 'snapshotBegin',
      snapshotId: snap.id,
      baseSeq: snap.baseSeq,
      total: snap.total,
      byteLength: snap.byteLength,
      kind: 'composite',
      levelName: snap.levelName,
      createdTs: snap.createdTs,
    }
    sendMessage(peer.socket, begin)
    for (let i = 0; i < snap.chunks.length; i++) {
      const chunkMsg: SnapshotChunkMsg = {
        type: 'snapshotChunk',
        snapshotId: snap.id,
        index: i,
        total: snap.total,
        payload: snap.chunks[i],
      }
      sendMessage(peer.socket, chunkMsg)
    }
    const end: SnapshotEndMsg = { type: 'snapshotEnd', snapshotId: snap.id }
    sendMessage(peer.socket, end)
  }

  private handleSnapshotApplied(peer: Peer, msg: SnapshotAppliedMsg): void {
    if (!msg.ok) {
      console.warn(`[EditorRelay] peer ${peer.authorId} reported snapshot apply failure: ${msg.error ?? 'unknown'} (attempt ${peer.snapshotAttempts})`)
      // Retry a fresh build before giving up. Peer stays gated so live ops
      // aren't applied on top of a half-baked scene. We cap attempts so a
      // persistently-broken peer eventually receives live ops instead of
      // being stuck in a silent stall.
      if (peer.snapshotAttempts < MAX_SNAPSHOT_RETRIES) {
        // Invalidate cached snapshot so we genuinely rebuild (the cached
        // one presumably had the issue that made apply fail).
        this.currentSnapshot = null
        peer.snapshotInFlight = false
        this.sendOrBuildSnapshotFor(peer)
        return
      }
      console.warn(`[EditorRelay] peer ${peer.authorId} exceeded snapshot retries; releasing gate with partial state`)
    }
    peer.snapshotPending = false
    peer.snapshotInFlight = false
    this.flushPendingQueue(peer)
  }

  private flushPendingQueue(peer: Peer): void {
    const q = peer.pendingQueue
    peer.pendingQueue = []
    for (const m of q) sendMessage(peer.socket, m)
  }

  /**
   * Persist the current snapshot to disk under the session dir using an
   * atomic rename (write tmp, rename over). Best-effort; failures logged.
   */
  private persistSnapshotToDisk(): void {
    if (!this.sessionDir || !this.currentSnapshot) return
    try {
      const tmp = join(this.sessionDir, 'snapshot.json.tmp')
      const final = join(this.sessionDir, 'snapshot.json')
      writeFileSync(tmp, JSON.stringify(this.currentSnapshot))
      renameSync(tmp, final)
    } catch (err) {
      console.warn('[EditorRelay] snapshot persist failed:', (err as Error).message)
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
      snapshotPending: false,
      snapshotInFlight: false,
      snapshotAttempts: 0,
      pendingQueue: [],
      authState: 'pending',
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
        // Synth-end any of the departing peer's mid-flight brush strokes
        // immediately so peers' replay contexts don't leak (the 3 s reaper
        // would catch them eventually but this is cleaner).
        const now = Date.now()
        for (const [id, st] of this.activeStrokes) {
          if (st.authorId !== peer.authorId) continue
          const synth: BrushMsg = {
            type: 'brush', authorId: st.authorId, ts: now, strokeId: id,
            kind: 'end', brushType: st.brushType,
            payload: { synthesized: true, reason: 'author-disconnect' },
          }
          this.activeStrokes.delete(id)
          this.broadcastBrush(synth, null)
        }
        this.emit('peerLeft', { authorId: peer.authorId, reason: 'disconnect' })
        // Let everyone else know
        for (const other of this.peers.values()) {
          sendMessage(other.socket, { type: 'leave', authorId: peer.authorId, reason: 'disconnect' })
        }
      }
      // If the peer was sitting in the approval queue, drop them from it too.
      if (peer.authorId && this.pendingApprovals.has(peer.authorId)) {
        this.pendingApprovals.delete(peer.authorId)
        this.emit('pendingApprovalsChanged', this.pendingApprovals.size)
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
      // Only accept ONE hello per connection — second one from a pending
      // peer just gets ignored so malicious clients can't spam approvals.
      if (peer.authState !== 'pending' || peer.authorId) {
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
      case 'env':
        this.ingestPeerEnv(peer, msg)
        return
      case 'field':
        this.ingestPeerField(peer, msg)
        return
      case 'snapshotApplied':
        this.handleSnapshotApplied(peer, msg)
        return
      case 'brush':
        this.ingestPeerBrush(peer, msg)
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
    // Mint authorId up-front so pending peers can be approved by id.
    const isUuid = typeof msg.authorId === 'string' && /^[0-9a-f-]{36}$/i.test(msg.authorId)
    const authorId = isUuid ? msg.authorId : randomUUID()
    peer.authorId = authorId
    peer.displayName = msg.displayName || `peer-${authorId.substring(0, 6)}`
    const beamUsername = typeof msg.beamUsername === 'string' && msg.beamUsername
      ? msg.beamUsername
      : null
    peer.pendingHello = {
      authorId,
      displayName: peer.displayName,
      beamUsername,
      fromSeq: typeof msg.fromSeq === 'number' ? msg.fromSeq : 0,
      remote: peer.remote,
    }

    // Mode 1: token — shared secret must match. Applied whenever a token
    // was configured, independent of `authMode` (so token can be additive).
    if (this.expectedToken !== null) {
      if (msg.token !== this.expectedToken) {
        sendMessage(peer.socket, { type: 'error', code: 'BAD_TOKEN', message: 'invalid session token' })
        peer.authState = 'rejected'
        try { peer.socket.destroy() } catch { /* ignore */ }
        return
      }
    }

    // Mode 2: friends — BeamMP username must be on the whitelist.
    if (this.authMode === 'friends') {
      const u = beamUsername ? beamUsername.toLowerCase() : null
      if (!u || !this.friendsWhitelist.has(u)) {
        sendMessage(peer.socket, { type: 'error', code: 'NOT_FRIEND', message: 'not on host friends whitelist' })
        peer.authState = 'rejected'
        try { peer.socket.destroy() } catch { /* ignore */ }
        return
      }
    }

    // Mode 3: approval — park in pending queue; UI decides.
    if (this.authMode === 'approval') {
      peer.authState = 'pending'
      this.pendingApprovals.set(authorId, peer)
      this.emit('peerPendingApproval', {
        authorId,
        displayName: peer.displayName,
        beamUsername,
        remote: peer.remote,
      })
      this.emit('pendingApprovalsChanged', this.pendingApprovals.size)
      console.log(`[EditorRelay] peer ${peer.remote} (${peer.displayName}) awaiting host approval`)
      return
    }

    // Everything else: admit immediately.
    this.admitPeer(peer, msg)
  }

  /**
   * Finish the welcome handshake for an authorized peer. Called directly
   * from `handleHello` for open/token/friends, or from `approvePeer` after
   * the host clicks Accept in approval mode.
   */
  private admitPeer(peer: Peer, msg: HelloMsg): void {
    const authorId = peer.authorId
    peer.authState = 'approved'
    peer.greeted = true
    this.peers.set(authorId, peer)

    // Send welcome
    const envSnapshot: EnvCacheEntry[] = Array.from(this.envState.values()).map((e) => ({
      key: e.key, value: e.value, authorId: e.authorId, ts: e.ts,
    }))
    sendMessage(peer.socket, {
      type: 'welcome',
      authorId: this.authorId,
      yourAuthorId: authorId,
      peers: Array.from(this.peers.values())
        .filter((p) => p.authorId !== authorId)
        .map((p) => ({ authorId: p.authorId, displayName: p.displayName })),
      lastSeq: this.seq,
      levelName: this.levelName,
      levelSource: this.levelSource ?? undefined,
      env: envSnapshot,
      project: this.getProjectWelcomeInfo() ?? undefined,
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

    // Snapshot exchange (Phase 3): if we have a launcher hooked up (i.e. we
    // can talk to host Lua), gate this peer behind a snapshot. Otherwise
    // skip — fromSeq replay alone is the legacy fallback.
    if (this.gameLauncher) {
      peer.snapshotPending = true
      peer.pendingQueue = []
      this.sendOrBuildSnapshotFor(peer)
    }

    console.log(`[EditorRelay] peer ${peer.remote} joined as ${authorId} (${peer.displayName})`)
    this.emit('peerJoined', { authorId, displayName: peer.displayName, remote: peer.remote })
  }

  /* ── Host-controlled auth surface ────────────────────────────────────── */

  /**
   * Accept a peer that is waiting in approval-mode. No-op if the peer has
   * gone away or was already admitted.
   */
  approvePeer(authorId: string): boolean {
    const peer = this.pendingApprovals.get(authorId)
    if (!peer) return false
    this.pendingApprovals.delete(authorId)
    this.emit('pendingApprovalsChanged', this.pendingApprovals.size)
    if (peer.socket.destroyed) return false
    // Synthesize a HelloMsg from the stored pending data.
    const hello: HelloMsg = {
      type: 'hello',
      protocol: 1,
      authorId: peer.pendingHello?.authorId ?? peer.authorId,
      displayName: peer.pendingHello?.displayName,
      fromSeq: peer.pendingHello?.fromSeq ?? 0,
    }
    this.admitPeer(peer, hello)
    return true
  }

  /** Reject a pending peer and close their socket. */
  rejectPeer(authorId: string, reason = 'rejected by host'): boolean {
    const peer = this.pendingApprovals.get(authorId)
    if (!peer) return false
    this.pendingApprovals.delete(authorId)
    this.emit('pendingApprovalsChanged', this.pendingApprovals.size)
    if (!peer.socket.destroyed) {
      sendMessage(peer.socket, { type: 'error', code: 'REJECTED', message: reason })
      peer.authState = 'rejected'
      try { peer.socket.destroy() } catch { /* ignore */ }
    }
    return true
  }

  /** Swap the friends whitelist without restarting the relay. */
  setFriendsWhitelist(usernames: string[]): void {
    this.friendsWhitelist = new Set(usernames.map((s) => s.toLowerCase()))
  }

  /** Swap the auth mode at runtime (e.g. host flips between token / approval). */
  setAuthMode(mode: RelayAuthMode): void {
    this.authMode = mode
  }

  /** Returns the current auth mode for UI display. */
  getAuthMode(): RelayAuthMode {
    return this.authMode
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
