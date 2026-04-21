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
import type { LuaOpEnvelope, LuaPose, LuaEnvObservation, LuaFieldObservation, LuaBrushObservation } from './EditorSyncBridgeSocket'
import type { OpMsg, WelcomeMsg, PoseMsg, EnvMsg, WelcomeProjectInfo } from './transports/SessionFrame'
import { EditorSyncRelayService, type RelayAuthMode } from './EditorSyncRelayService'
import { PeerClient } from './PeerClient'
import { encodeSessionCode } from '../../shared/sessionCode'

/** Re-exported for the handler layer; mirrors the shared/types.ts shape. */
export type SessionProjectInfo = WelcomeProjectInfo

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
  /** Host-only: current auth mode; `null` when idle or joined. */
  authMode: RelayAuthMode | null
  /** Host-only: queue of joiners awaiting host approval. */
  pendingApprovals: Array<{
    authorId: string
    displayName: string
    beamUsername: string | null
    remote: string
  }>
  /** Optional: shareable session code (set when hosting). */
  sessionCode: string | null
  /**
   * Host side: the project the relay is currently advertising to joiners.
   * Joiner side: the project the host is offering (what we received in the
   * welcome frame). `null` on both sides when no project is in play.
   */
  project: SessionProjectInfo | null
  /** Joiner side: download progress of the offered project (0..1). */
  projectDownload: { received: number; total: number; done: boolean; error?: string } | null
  /** Joiner side: local path where the downloaded project was extracted. */
  projectInstalledPath: string | null
}

interface Events {
  statusChanged: (status: SessionStatus) => void
  opBroadcast: (op: OpMsg) => void
  error: (err: Error) => void
  log: (entry: SessionLogEntry) => void
  peerPose: (pose: PeerPoseEntry) => void
  peerActivity: (act: PeerActivity) => void
  /** A joiner is waiting in the approval queue; UI should prompt the host. */
  peerPendingApproval: (peer: {
    authorId: string
    displayName: string
    beamUsername: string | null
    remote: string
  }) => void
  /**
   * Emitted on the joiner side right after welcome. Tells the UI what level
   * the host is on + what the host said about its source, so the UI can
   * compare against the local install and prompt if missing. Fired even if
   * the level IS installed — the UI decides what to show.
   */
  levelRequired: (info: {
    levelName: string | null
    levelSource: { builtIn: boolean; modPath?: string; hash?: string } | null
  }) => void
  /**
   * Emitted on the joiner side right after welcome when the host advertised
   * a project. The UI should show a "Download shared project" prompt.
   * Not emitted when the host has no active project.
   */
  projectOffered: (info: SessionProjectInfo) => void
}

export interface SessionLogEntry {
  ts: number
  level: 'info' | 'warn' | 'error'
  source: 'relay' | 'peer' | 'bridge' | 'session' | 'snapshot'
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
  /**
   * Shareable session code minted in `startHost` once we know the public
   * address + port. `null` when not hosting.
   */
  private sessionCode: string | null = null
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
  /**
   * Project the host is offering (hosting) or that was advertised to us
   * (joined). Mirrors `getStatus().project`.
   */
  private activeProject: SessionProjectInfo | null = null
  /** Joiner-side progress + install path for the project transfer. */
  private projectDownload: { received: number; total: number; done: boolean; error?: string } | null = null
  private projectInstalledPath: string | null = null

  constructor(private readonly gameLauncher: GameLauncherService) {
    super()
    // Route every Lua op through us.
    gameLauncher.setEditorOpListener((_seq, env) => this.ingestLocalOp(env))
    // Route every Lua pose tick through us (broadcast to peers + expose locally).
    gameLauncher.setEditorPoseListener((pose) => this.ingestLocalPose(pose))
    // Route every Lua env observation through us (Phase 1 env channel).
    gameLauncher.setEditorEnvListener((obs) => this.ingestLocalEnv(obs))
    // Route every Lua field observation through us (Phase 2 field channel).
    gameLauncher.setEditorFieldListener((obs) => this.ingestLocalField(obs))
    // Route every Lua brush stroke frame through us (Phase 4 brush channel).
    gameLauncher.setEditorBrushListener((obs) => this.ingestLocalBrush(obs))
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
    const relayStatus = this.relay?.status() ?? null
    return {
      state: this.state,
      authorId: this.authorId,
      displayName: this.displayName,
      sessionId: this.sessionId,
      host: this.host,
      port: this.port,
      token: this.state === 'hosting' ? this.token : null,
      levelName: this.levelName,
      lastSeq: relayStatus?.lastSeq ?? this.peer?.getLastSeq() ?? 0,
      peers: [...this.peers],
      bridgeReady: this.gameLauncher.isEditorBridgeReady(),
      opsIn: this.opsIn,
      opsOut: this.opsOut,
      authMode: relayStatus?.authMode ?? null,
      pendingApprovals: relayStatus?.pendingApprovals ?? [],
      sessionCode: this.sessionCode,
      project: this.activeProject,
      projectDownload: this.projectDownload,
      projectInstalledPath: this.projectInstalledPath,
    }
  }

  /* ── Host ─────────────────────────────────────────────────────────── */

  async startHost(opts: {
    beamcmDir: string
    port?: number
    token?: string | null
    levelName?: string | null
    displayName?: string
    authMode?: RelayAuthMode
    friendsWhitelist?: string[]
    levelSource?: { builtIn: boolean; modPath?: string; hash?: string } | null
    /**
     * Public-facing host address to embed in the session code. If omitted,
     * callers (IPC handler) can fill it in afterwards via `setAdvertiseHost`.
     */
    advertiseHost?: string | null
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
    // Approval-mode: surface pending joiners to the renderer so the host
    // UI can prompt "Accept <name>?".
    relay.on('peerPendingApproval', (p) => {
      this.log('info', 'relay', `Peer awaiting approval: ${p.displayName} (${p.remote})`)
      this.emit('peerPendingApproval', p)
      this.pushStatus()
    })
    relay.on('pendingApprovalsChanged', () => {
      this.pushStatus()
    })
    // Every committed op from the relay that wasn't authored by host goes to
    // local Lua for application.
    relay.onBroadcast((op) => {
      this.opsOut++
      this.gameLauncher.sendEditorRemoteOp(op)
      this.emit('opBroadcast', op)
      this.recordActivityFromOp(op)
      this.pushStatus()
    })
    // Same for env channel — forward peer-authored env messages down to local Lua.
    relay.onEnvBroadcast((env) => {
      this.gameLauncher.sendEditorRemoteEnv(env)
    })
    // Same for field channel.
    relay.onFieldBroadcast((field) => {
      this.gameLauncher.sendEditorRemoteField(field)
    })
    // Same for brush channel (Phase 4).
    relay.onBrushBroadcast((brush) => {
      this.gameLauncher.sendEditorRemoteBrush(brush)
    })

    // Phase 3: relay drives snapshot builds via the launcher and accepts
    // chunks emitted by host Lua. Wire both ends.
    relay.setGameLauncher(this.gameLauncher)
    this.gameLauncher.setEditorSnapshotChunkListener((chunk) => relay.ingestSnapshotChunk(chunk))
    // Host doesn't need snapshotApplied acks from itself; clear the joiner-
    // side ack hook so a stale callback from a previous join doesn't fire.
    this.gameLauncher.setEditorSnapshotAppliedListener(null)

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
        authMode: opts.authMode,
        friendsWhitelist: opts.friendsWhitelist,
        levelSource: opts.levelSource ?? null,
      })
      this.sessionId = st.sessionId
      this.host = `0.0.0.0:${st.port}`
      this.port = st.port
      this.state = 'hosting'
      this.sessionCode = encodeSessionCode({
        host: opts.advertiseHost || '0.0.0.0',
        port: st.port,
        token: this.token,
        level: this.levelName,
        sessionId: st.sessionId,
        displayName: this.displayName,
      })
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

  /**
   * Host-only: re-mint the session code for a different advertise-host (e.g.
   * user flips from Tailscale to Public IP in the UI). No-op when not hosting.
   */
  setAdvertiseHost(host: string): void {
    if (this.state !== 'hosting' || this.port == null) return
    this.sessionCode = encodeSessionCode({
      host,
      port: this.port,
      token: this.token,
      level: this.levelName,
      sessionId: this.sessionId ?? undefined,
      displayName: this.displayName,
    })
    this.pushStatus()
  }

  /** Host-only: accept a pending approval-mode joiner. */
  approvePeer(authorId: string): boolean {
    if (!this.relay) return false
    return this.relay.approvePeer(authorId)
  }

  /** Host-only: reject a pending approval-mode joiner. */
  rejectPeer(authorId: string, reason?: string): boolean {
    if (!this.relay) return false
    return this.relay.rejectPeer(authorId, reason)
  }

  /** Host-only: update the friends whitelist (case-insensitive BeamMP names). */
  setFriendsWhitelist(usernames: string[]): boolean {
    if (!this.relay) return false
    this.relay.setFriendsWhitelist(usernames)
    this.pushStatus()
    return true
  }

  /** Host-only: switch auth mode at runtime. */
  setAuthMode(mode: RelayAuthMode): boolean {
    if (!this.relay) return false
    this.relay.setAuthMode(mode)
    this.pushStatus()
    return true
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
    // Env-channel inbound: apply directly to local Lua. Peer→host→us routing
    // already filtered out our own echoes by authorId.
    client.on('remoteEnv', (env) => {
      this.gameLauncher.sendEditorRemoteEnv(env)
    })
    client.on('remoteField', (field) => {
      this.gameLauncher.sendEditorRemoteField(field)
    })
    client.on('remoteBrush', (brush) => {
      this.gameLauncher.sendEditorRemoteBrush(brush)
    })
    // Host pushed a new/updated project offer mid-session. If the sha256
    // differs from what we've installed, expose it to the UI so the user
    // can re-download + auto-relaunch into the new starting point.
    client.on('projectOffered', (info) => {
      const prev = this.activeProject
      this.activeProject = info
      if (!prev || prev.sha256 !== info.sha256) {
        // Clear stale install pointer — the current folder may not match
        // the new offer. Download progress resets too.
        this.projectDownload = null
        this.projectInstalledPath = null
        this.log(
          'info',
          'peer',
          `Host updated shared project: "${info.name}" ` +
            `(${info.levelName}, ${Math.round(info.sizeBytes / 1024)} KiB)`
        )
        this.emit('projectOffered', info)
      }
      this.pushStatus()
    })

    // Phase 3 — host streams a snapshot to us as snapshotBegin/Chunk*/End.
    // Forward chunks straight to local Lua for reassembly + apply. The Lua
    // side acks via Z| frames; the launcher surfaces them via the
    // snapshotApplied listener (wired below) which we forward back to host.
    client.on('snapshotBegin', (msg) => {
      this.log('info', 'snapshot', `Receiving snapshot ${msg.snapshotId.substring(0, 8)} (${msg.total} chunks, ${msg.byteLength} B, baseSeq=${msg.baseSeq})`)
    })
    client.on('snapshotChunk', (msg) => {
      this.gameLauncher.sendEditorSnapshotChunk({
        snapshotId: msg.snapshotId,
        index: msg.index,
        total: msg.total,
        payload: msg.payload,
      })
    })
    client.on('snapshotEnd', (msg) => {
      this.log('info', 'snapshot', `Snapshot ${msg.snapshotId.substring(0, 8)} fully received from host; awaiting Lua apply…`)
    })
    this.gameLauncher.setEditorSnapshotChunkListener(null)
    this.gameLauncher.setEditorSnapshotAppliedListener((ack) => {
      this.log(ack.ok ? 'info' : 'error', 'snapshot',
        `Local Lua ${ack.ok ? 'applied' : 'failed to apply'} snapshot ${ack.snapshotId.substring(0, 8)}` + (ack.error ? `: ${ack.error}` : ''))
      client.sendSnapshotApplied(ack.snapshotId, ack.ok, ack.error)
    })
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
      this.activeProject = null
      this.projectDownload = null
      this.projectInstalledPath = null
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
      // Phase-A: surface level + source info so the joiner UI can decide
      // whether to prompt for install.
      this.emit('levelRequired', {
        levelName: welcome.levelName ?? null,
        levelSource: welcome.levelSource ?? null,
      })
      // Offered-project: host advertised a project zip we can download. We
      // don't auto-download — renderer prompts the user first.
      if (welcome.project) {
        this.activeProject = welcome.project
        this.projectDownload = null
        this.projectInstalledPath = null
        this.log(
          'info',
          'peer',
          `Host is offering project "${welcome.project.name}" ` +
            `(${welcome.project.levelName}, ${Math.round(welcome.project.sizeBytes / 1024)} KiB)`
        )
        this.emit('projectOffered', welcome.project)
      } else {
        this.activeProject = null
      }
      // Cold-join env: replay every entry from the welcome cache so we
      // immediately see ToD/weather/gravity/simSpeed without waiting for
      // a peer to touch a slider. The Lua side will suppress capture so we
      // don't echo these back as if they were local changes.
      if (welcome.env && welcome.env.length > 0) {
        for (const entry of welcome.env) {
          this.gameLauncher.sendEditorRemoteEnv({
            type: 'env',
            authorId: entry.authorId,
            ts: entry.ts,
            key: entry.key,
            value: entry.value,
          } satisfies EnvMsg)
        }
        this.log('info', 'peer', `Applied ${welcome.env.length} env key(s) from host snapshot`)
      }
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

  /* ── Project (host side: advertise; joiner side: download) ───────── */

  /**
   * Host-only: tell the relay what project folder to advertise to peers.
   * The relay zips it in memory, hashes it, and starts / keeps the HTTP
   * download listener alive. Subsequent joiners see the project in their
   * welcome frame; already-connected peers will learn about it the next
   * time they open the UI (pull via getStatus) — we don't push retroactive
   * offers for now to keep the protocol minimal.
   */
  async setActiveProject(params: {
    name: string
    levelName: string
    folder: string
    absDir: string
  }): Promise<SessionProjectInfo | null> {
    if (this.state !== 'hosting' || !this.relay) {
      this.log('warn', 'session', 'setActiveProject: not hosting')
      return null
    }
    const info = await this.relay.setActiveProject(params)
    this.activeProject = info
    this.pushStatus()
    if (info) {
      this.log('info', 'session', `Advertising project "${info.name}" (${info.sizeBytes} B) on HTTP :${info.httpPort}`)
    }
    return info
  }

  /** Returns the currently-advertised or -offered project, or null. */
  getActiveProject(): SessionProjectInfo | null {
    return this.activeProject
  }

  /**
   * Joiner-only: progress callback for the renderer / IPC layer to keep
   * `status.projectDownload` in sync during the HTTP fetch.
   */
  reportProjectDownloadProgress(received: number, total: number): void {
    this.projectDownload = { received, total, done: false }
    this.pushStatus()
  }

  /** Joiner-only: called once the downloaded project has been extracted. */
  reportProjectInstalled(installedPath: string | null, error?: string): void {
    if (error) {
      this.projectDownload = {
        received: this.projectDownload?.received ?? 0,
        total: this.projectDownload?.total ?? 0,
        done: true,
        error,
      }
    } else {
      this.projectDownload = this.projectDownload
        ? { ...this.projectDownload, done: true }
        : { received: 0, total: 0, done: true }
    }
    this.projectInstalledPath = installedPath
    this.pushStatus()
  }

  /** Returns the host ip (without port) for the joined session, or null. */
  getJoinedHost(): string | null {
    return this.host ? this.host.split(':')[0] ?? null : null
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
    this.sessionCode = null
    this.levelName = null
    this.token = null
    this.opsIn = 0
    this.opsOut = 0
    this.activeProject = null
    this.projectDownload = null
    this.projectInstalledPath = null
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

  /* ── Env channel ────────────────────────────────────────────────────── */

  /**
   * Local Lua reported a scene-globals diff (ToD, weather, gravity, …).
   * Hosting: hand to relay (LWW + broadcast). Joined: forward to host as a
   * single env frame. Idle: drop on the floor.
   */
  private ingestLocalEnv(obs: LuaEnvObservation): void {
    if (this.state === 'hosting' && this.relay) {
      this.relay.ingestLocalEnv(obs)
    } else if (this.state === 'joined' && this.peer) {
      this.peer.sendEnv({ key: obs.key, value: obs.value, ts: obs.ts })
    }
  }

  /**
   * Local Lua reported a per-object field write (helper or polling diff).
   * Same hosting/joined routing as env.
   */
  private ingestLocalField(obs: LuaFieldObservation): void {
    if (this.state === 'hosting' && this.relay) {
      this.relay.ingestLocalField(obs)
    } else if (this.state === 'joined' && this.peer) {
      this.peer.sendField({
        pid: obs.pid,
        fieldName: obs.fieldName,
        arrayIndex: obs.arrayIndex,
        value: obs.value,
        ts: obs.ts,
      })
    }
  }

  /**
   * Local Lua reported a brush stroke frame (Phase 4). Same hosting/joined
   * routing as env/field — host bypasses the wire and feeds the relay
   * directly; joiner sends it to the host who fans it out.
   */
  private ingestLocalBrush(obs: LuaBrushObservation): void {
    if (this.state === 'hosting' && this.relay) {
      this.relay.ingestLocalBrush(obs)
    } else if (this.state === 'joined' && this.peer) {
      this.peer.sendBrush({
        strokeId: obs.strokeId,
        brushType: obs.brushType,
        kind: obs.kind,
        payload: obs.payload,
        ts: obs.ts,
      })
    }
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
