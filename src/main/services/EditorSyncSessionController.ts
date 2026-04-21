/**
 * Owns the collaborative world-editor session on one CM instance.
 *
 * Exactly one of two modes at a time:
 *   IDLE    — no session
 *   HOSTING — running `EditorSyncRelayService`; any number of peers can join
 *   JOINED  — connected to a remote host via `PeerClient`
 *
 * Wiring:
 *   local Lua op → GameLauncher.onLuaOp → this.ingestLocalOp
 *     - HOSTING: relay.ingestLocalOp → broadcast to peers
 *     - JOINED : peerClient.sendOp → host → other peers
 *
 *   remote op → (relay onBroadcast | peerClient on 'remoteOp')
 *               → gameLauncher.sendEditorRemoteOp → Lua applies as R|
 */

import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import type { GameLauncherService } from './GameLauncherService'
import type { LuaOpEnvelope, LuaPose } from './EditorSyncBridgeSocket'
import type { OpMsg, WelcomeMsg, PoseMsg } from './transports/SessionFrame'
import { EditorSyncRelayService } from './EditorSyncRelayService'
import { PeerClient } from './PeerClient'

export type SessionState = 'idle' | 'hosting' | 'joined' | 'connecting'

export interface SessionStatus {
  state: SessionState
  authorId: string
  displayName: string
  sessionId: string | null
  host: string | null          // "ip:port" when joined or "0.0.0.0:port" when hosting
  port: number | null
  token: string | null         // presence only when hosting; never leaks token from joiner side
  levelName: string | null
  lastSeq: number
  peers: Array<{ authorId: string; displayName: string; remote?: string }>
  bridgeReady: boolean
  /** Total ops we have forwarded to / received from the Lua bridge in this session. */
  opsIn: number
  opsOut: number
}

interface Events {
  statusChanged: (status: SessionStatus) => void
  opBroadcast: (op: OpMsg) => void
  error: (err: Error) => void
  log: (entry: SessionLogEntry) => void
  peerPose: (pose: PeerPoseEntry) => void
  peerActivity: (act: PeerActivity) => void
}

export interface SessionLogEntry {
  ts: number
  level: 'info' | 'warn' | 'error'
  source: 'relay' | 'peer' | 'bridge' | 'session'
  message: string
}

/** Live position snapshot of one peer (or the local user). */
export interface PeerPoseEntry {
  authorId: string
  displayName: string
  ts: number
  x: number
  y: number
  z: number
  heading?: number
  inVehicle?: boolean
  vehicle?: string
  levelName?: string | null
  /** `true` for the local player's pose. */
  self?: boolean
}

/** Most-recent edit performed by a peer (or local user). */
export interface PeerActivity {
  authorId: string
  displayName: string
  ts: number
  /** Editor action name, e.g. "Move", "Paste", "SetObjectTransform". */
  name?: string
  kind: 'do' | 'undo' | 'redo'
  detail?: string
}

export class EditorSyncSessionController extends EventEmitter {
  private state: SessionState = 'idle'
  private relay: EditorSyncRelayService | null = null
  private peer: PeerClient | null = null
  private readonly authorId: string = randomUUID()
  private displayName: string = 'Player'
  private levelName: string | null = null
  private token: string | null = null
  private host: string | null = null
  private port: number | null = null
  private sessionId: string | null = null
  private peers: Array<{ authorId: string; displayName: string; remote?: string }> = []
  private opsIn = 0
  private opsOut = 0
  /** Latest pose per authorId (including `self`). LRU-evicted by prunePoses. */
  private poses: Map<string, PeerPoseEntry> = new Map()
  /** Latest edit (op) per authorId, for "last activity" highlights. */
  private activity: Map<string, PeerActivity> = new Map()
  /** Set true once we've logged a level-mismatch warning; reset when matched. */
  private warnedLevelMismatch = false
  /** Set while leave() is unwinding so we don't log scary warnings for a normal
   *  user-initiated disconnect. */
  private userInitiatedLeave = false

  constructor(private readonly gameLauncher: GameLauncherService) {
    super()
    // Route every Lua op through us.
    gameLauncher.setEditorOpListener((_seq, env) => this.ingestLocalOp(env))
    // Route every Lua pose tick through us (broadcast to peers + expose locally).
    gameLauncher.setEditorPoseListener((pose) => this.ingestLocalPose(pose))
    // Prune stale peer poses every 2 s. Singleton-scoped; we keep the handle so
    // it could be cleared in a future shutdown path, and unref() so it never
    // blocks Electron's main process from exiting.
    const t = setInterval(() => this.prunePoses(), 2000)
    if (typeof t.unref === 'function') t.unref()
  }

  override on<E extends keyof Events>(event: E, listener: Events[E]): this {
    return super.on(event, listener)
  }
  override emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean {
    return super.emit(event, ...args)
  }

  setDisplayName(name: string): void {
    this.displayName = name || 'Player'
  }

  getStatus(): SessionStatus {
    return {
      state: this.state,
      authorId: this.authorId,
      displayName: this.displayName,
      sessionId: this.sessionId,
      host: this.host,
      port: this.port,
      token: this.state === 'hosting' ? this.token : null,
      levelName: this.levelName,
      lastSeq: this.relay?.status().lastSeq ?? this.peer?.getLastSeq() ?? 0,
      peers: [...this.peers],
      bridgeReady: this.gameLauncher.isEditorBridgeReady(),
      opsIn: this.opsIn,
      opsOut: this.opsOut,
    }
  }

  /* ── Host ─────────────────────────────────────────────────────────── */

  async startHost(opts: {
    beamcmDir: string
    port?: number
    token?: string | null
    levelName?: string | null
    displayName?: string
  }): Promise<SessionStatus> {
    if (this.state !== 'idle') {
      throw new Error(`cannot host from state ${this.state}`)
    }
    if (opts.displayName) this.setDisplayName(opts.displayName)
    const relay = new EditorSyncRelayService()

    relay.on('peerJoined', (p) => {
      this.peers.push({ authorId: p.authorId, displayName: p.displayName, remote: p.remote })
      this.log('info', 'relay', `Peer joined: ${p.displayName} (${p.remote ?? p.authorId.substring(0, 8)})`)
      this.pushStatus()
    })
    relay.on('peerLeft', (p) => {
      const existing = this.peers.find((x) => x.authorId === p.authorId)
      const name = existing?.displayName ?? p.authorId.substring(0, 8)
      this.peers = this.peers.filter((x) => x.authorId !== p.authorId)
      this.poses.delete(p.authorId)
      this.activity.delete(p.authorId)
      this.log('info', 'relay', `Peer left: ${name} (${p.reason})`)
      this.pushStatus()
    })
    // Relay forwards peer poses — update map + emit.
    relay.on('peerPose', (pose) => this.ingestRemotePose(pose))
    // Every committed op from the relay that wasn't authored by host goes to
    // local Lua for application.
    relay.onBroadcast((op) => {
      this.opsOut++
      this.gameLauncher.sendEditorRemoteOp(op)
      this.emit('opBroadcast', op)
      this.recordActivityFromOp(op)
      this.pushStatus()
    })

    this.relay = relay
    this.levelName = opts.levelName ?? null
    this.token = opts.token ?? null
    this.state = 'connecting'
    this.pushStatus()

    try {
      const st = await relay.start({
        beamcmDir: opts.beamcmDir,
        port: opts.port,
        levelName: this.levelName,
        token: this.token,
      })
      this.sessionId = st.sessionId
      this.host = `0.0.0.0:${st.port}`
      this.port = st.port
      this.state = 'hosting'
      this.log('info', 'relay', `Hosting on port ${st.port}${this.token ? ' (token required)' : ' (open session)'}`)
      this.pushStatus()
      return this.getStatus()
    } catch (err) {
      this.relay = null
      this.state = 'idle'
      this.pushStatus()
      throw err
    }
  }

  /* ── Join ─────────────────────────────────────────────────────────── */

  async startJoin(opts: {
    host: string
    port: number
    token?: string | null
    displayName?: string
    fromSeq?: number
  }): Promise<SessionStatus> {
    if (this.state !== 'idle') {
      throw new Error(`cannot join from state ${this.state}`)
    }
    if (opts.displayName) this.setDisplayName(opts.displayName)
    const client = new PeerClient()

    client.on('remoteOp', (op) => {
      this.opsOut++
      this.gameLauncher.sendEditorRemoteOp(op)
      this.emit('opBroadcast', op)
      this.recordActivityFromOp(op)
      this.pushStatus()
    })
    client.on('remotePose', (pose) => this.ingestRemotePose(pose))
    client.on('peerLeft', (p) => {
      this.peers = this.peers.filter((x) => x.authorId !== p.authorId)
      this.poses.delete(p.authorId)
      this.activity.delete(p.authorId)
      this.pushStatus()
    })
    client.on('closed', () => {
      // A user-initiated leave will close the socket on its own; suppress the
      // scary 'warn' so we don't pollute the session log for a normal action.
      if (!this.userInitiatedLeave) {
        this.log('warn', 'peer', 'Disconnected from host')
      }
      // Host went away — drop to idle.
      this.peer = null
      this.state = 'idle'
      this.peers = []
      this.host = null
      this.port = null
      this.sessionId = null
      this.levelName = null
      this.token = null
      this.pushStatus()
    })
    client.on('error', (err) => {
      this.log('error', 'peer', err.message)
      this.emit('error', err)
    })

    this.peer = client
    this.state = 'connecting'
    this.pushStatus()
    this.log('info', 'peer', `Connecting to ${opts.host}:${opts.port}…`)

    try {
      const welcome: WelcomeMsg = await client.connect({
        host: opts.host,
        port: opts.port,
        token: opts.token ?? undefined,
        authorId: this.authorId,
        displayName: this.displayName,
        fromSeq: opts.fromSeq,
      })
      this.host = `${opts.host}:${opts.port}`
      this.port = opts.port
      this.sessionId = null
      this.levelName = welcome.levelName ?? null
      this.peers = welcome.peers.map((p) => ({
        authorId: p.authorId, displayName: p.displayName || 'peer',
      }))
      this.state = 'joined'
      this.log('info', 'peer', `Connected to ${opts.host}:${opts.port}${welcome.levelName ? ` — level ${welcome.levelName}` : ''}`)
      this.pushStatus()
      return this.getStatus()
    } catch (err) {
      this.peer = null
      this.state = 'idle'
      this.log('error', 'peer', `Connect failed: ${err instanceof Error ? err.message : String(err)}`)
      this.pushStatus()
      throw err
    }
  }

  /* ── Launch BeamNG into the World Editor ──────────────────────────── */

  /**
   * Resolve the level CM should pass to BeamNG when launching directly into
   * the World Editor for this session, and arm the editor autostart signal
   * so the editor opens automatically once the level finishes loading.
   *
   * The caller (IPC handler) is responsible for the actual `launchVanilla`
   * call — we only know the *intent*, not the GamePaths.
   *
   * Returns `{ level }` on success or `{ error }` if no level can be
   * determined yet (host hasn't loaded one and joiner hasn't received one).
   */
  prepareEditorLaunch(opts: {
    userDir: string
    levelOverride?: string | null
  }): { level: string | null; error: string | null } {
    const level = opts.levelOverride ?? this.normalizeLevelName(this.levelName)
    if (!level) {
      return {
        level: null,
        error:
          'No level known for this session yet. Either the host has not loaded a level or the bridge has not reported one.',
      }
    }
    this.gameLauncher.writeEditorAutostartSignal(opts.userDir)
    this.log('info', 'session', `Launching BeamNG into World Editor on level "${level}"`)
    return { level, error: null }
  }

  /**
   * Strip "/info.json" suffix and "levels/" prefix that BeamNG sometimes
   * surfaces in `getMissionFilename()`, leaving just the level folder name
   * that `-level <name>/info.json` expects.
   */
  private normalizeLevelName(raw: string | null): string | null {
    if (!raw) return null
    let s = raw
    s = s.replace(/^\/+/, '').replace(/^levels\//i, '')
    s = s.replace(/\/info\.json$/i, '')
    s = s.replace(/\/main\/.*$/i, '')
    return s || null
  }

  /* ── Leave ────────────────────────────────────────────────────────── */

  leave(): void {
    const wasHosting = this.state === 'hosting'
    const wasJoined = this.state === 'joined'
    this.userInitiatedLeave = true
    try {
      if (this.relay) {
        try { this.relay.stop() } catch { /* ignore */ }
        this.relay = null
      }
      if (this.peer) {
        try { this.peer.disconnect() } catch { /* ignore */ }
        this.peer = null
      }
    } finally {
      // Re-arm the warning for any future host-side disconnect after we've
      // finished tearing down. The 'closed' callback fires synchronously from
      // disconnect(), so by this point any suppression we wanted is done.
      this.userInitiatedLeave = false
    }
    if (wasHosting) this.log('info', 'session', 'Stopped hosting')
    else if (wasJoined) this.log('info', 'session', 'Left session')
    this.state = 'idle'
    this.peers = []
    // Wipe every peer pose/activity; keep our own self pose (it was fresh just now).
    for (const [id] of this.poses) if (id !== this.authorId) this.poses.delete(id)
    for (const [id] of this.activity) if (id !== this.authorId) this.activity.delete(id)
    this.host = null
    this.port = null
    this.sessionId = null
    this.levelName = null
    this.token = null
    this.opsIn = 0
    this.opsOut = 0
    this.pushStatus()
  }

  /* ── Ingest local Lua op ──────────────────────────────────────────── */

  private ingestLocalOp(env: LuaOpEnvelope): void {
    this.opsIn++
    // Record as local-user activity so the UI can show "You: Move (42s ago)".
    this.recordActivity({
      authorId: this.authorId,
      displayName: this.displayName,
      ts: Date.now(),
      kind: env.kind,
      name: env.name,
      detail: env.detail,
    })
    if (this.state === 'hosting' && this.relay) {
      this.relay.ingestLocalOp(env)
    } else if (this.state === 'joined' && this.peer) {
      this.peer.sendOp({
        kind: env.kind,
        clientOpId: env.clientOpId,
        name: env.name,
        data: env.data,
        detail: env.detail,
        targets: env.targets,
        ts: env.ts,
      })
    }
    // idle: drop; the op already executed locally and we're not syncing.
    this.pushStatus()
  }

  /* ── Pose plumbing ─────────────────────────────────────────────────── */

  private ingestLocalPose(pose: LuaPose): void {
    // Always surface locally (even when idle — so the UI can show our own
    // coords for debugging). Tagged as self.
    const entry: PeerPoseEntry = {
      authorId: this.authorId,
      displayName: this.displayName,
      ts: pose.ts || Date.now(),
      x: pose.x,
      y: pose.y,
      z: pose.z,
      heading: pose.heading,
      inVehicle: pose.inVehicle,
      vehicle: pose.vehicle,
      levelName: pose.levelName ?? null,
      self: true,
    }
    this.poses.set(this.authorId, entry)
    this.emit('peerPose', entry)
    // Host-side: adopt the Lua-reported level into the relay/status the
    // first time we see it (or whenever it changes), so future joiners get
    // the right `welcome.levelName`.
    if (
      this.state === 'hosting' &&
      this.relay &&
      pose.levelName &&
      this.levelName !== pose.levelName
    ) {
      this.levelName = pose.levelName
      this.relay.setLevelName(pose.levelName)
      this.log('info', 'session', `Host level set to ${pose.levelName}`)
      this.pushStatus()
    }
    // Joined-side: warn (once) if our level doesn't match the host's.
    // The remote-op apply path drops ops we can't resolve anyway, but a clear
    // log line tells the user *why* their edits aren't propagating.
    if (
      this.state === 'joined' &&
      this.levelName &&
      pose.levelName &&
      pose.levelName !== this.levelName
    ) {
      if (!this.warnedLevelMismatch) {
        this.warnedLevelMismatch = true
        this.log(
          'warn',
          'session',
          `You are on "${pose.levelName}" but the host is on "${this.levelName}". Use "Launch into editor" to load the host's level.`
        )
      }
    } else if (
      this.state === 'joined' &&
      this.levelName &&
      pose.levelName &&
      pose.levelName === this.levelName
    ) {
      // Only re-arm the warning once we've actually confirmed a match. We
      // intentionally don't reset on partial state (e.g. level still loading)
      // to avoid re-firing the warning on every new pose tick.
      this.warnedLevelMismatch = false
    }
    // Broadcast to peers when in a session.
    const payload = {
      ts: entry.ts,
      displayName: this.displayName,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      heading: entry.heading,
      inVehicle: entry.inVehicle,
      vehicle: entry.vehicle,
      levelName: entry.levelName,
    }
    if (this.state === 'hosting' && this.relay) {
      this.relay.broadcastLocalPose(payload)
    } else if (this.state === 'joined' && this.peer) {
      this.peer.sendPose(payload)
    }
  }

  private ingestRemotePose(pose: PoseMsg): void {
    const entry: PeerPoseEntry = {
      authorId: pose.authorId,
      displayName: pose.displayName || `peer-${pose.authorId.substring(0, 6)}`,
      ts: pose.ts || Date.now(),
      x: pose.x,
      y: pose.y,
      z: pose.z,
      heading: pose.heading,
      inVehicle: pose.inVehicle,
      vehicle: pose.vehicle,
      levelName: pose.levelName ?? null,
    }
    this.poses.set(pose.authorId, entry)
    this.emit('peerPose', entry)
    // Push the pose down into the local Lua extension so it can render an
    // in-world ghost marker (sphere + name) at this peer's position. Best
    // effort — silently no-ops if BeamNG isn't running yet.
    this.gameLauncher.sendEditorRemotePose({
      authorId: entry.authorId,
      displayName: entry.displayName,
      ts: entry.ts,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      heading: entry.heading,
      inVehicle: entry.inVehicle,
      vehicle: entry.vehicle,
      levelName: entry.levelName,
    })
  }

  private prunePoses(): void {
    const now = Date.now()
    const STALE_MS = 10_000
    for (const [id, p] of this.poses) {
      // Never prune our own pose — we always have one while bridge is up.
      if (p.self) continue
      if (now - p.ts > STALE_MS) this.poses.delete(id)
    }
  }

  private recordActivityFromOp(op: OpMsg): void {
    if (op.authorId === this.authorId) return // local already recorded
    const peer = this.peers.find((x) => x.authorId === op.authorId)
    this.recordActivity({
      authorId: op.authorId,
      displayName: peer?.displayName ?? `peer-${op.authorId.substring(0, 6)}`,
      ts: op.ts || Date.now(),
      kind: op.kind,
      name: op.name,
      detail: op.detail,
    })
  }

  private recordActivity(act: PeerActivity): void {
    this.activity.set(act.authorId, act)
    this.emit('peerActivity', act)
  }

  private pushStatus(): void {
    this.emit('statusChanged', this.getStatus())
  }

  private log(level: SessionLogEntry['level'], source: SessionLogEntry['source'], message: string): void {
    this.emit('log', { ts: Date.now(), level, source, message })
  }
}
