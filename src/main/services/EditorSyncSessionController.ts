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
import { randomUUID, createHash } from 'crypto'
import { inflateRawSync } from 'zlib'
import { createWriteStream } from 'fs'
import { mkdir, unlink } from 'fs/promises'
import { dirname } from 'path'
import type { GameLauncherService } from './GameLauncherService'
import type { LuaOpEnvelope, LuaPose, LuaEnvObservation, LuaFieldObservation, LuaBrushObservation } from './EditorSyncBridgeSocket'
import type { OpMsg, WelcomeMsg, PoseMsg, EnvMsg, WelcomeProjectInfo, WelcomeModManifest } from './transports/SessionFrame'
import { EditorSyncRelayService, type RelayAuthMode } from './EditorSyncRelayService'
import { PeerClient } from './PeerClient'
import { encodeSessionCode } from '../../shared/sessionCode'
import { ModSyncJoinerService } from './ModSyncJoinerService'
import { ModInventoryService } from './ModInventoryService'
import type { ModDiffResult, ModManifest } from './ModInventoryService'
import { CoopSessionStagingService } from './CoopSessionStagingService'
import type { ModInfo } from '../../shared/types'
import { buildInverseOp } from './EditorOpInverter'
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
  /**
   * Tier 4 Phase 3 mod sync. Emitted on the joiner side after running the
   * diff against `welcome.mods`. UI shows the prompt with size + breakdown
   * (missing / drift / local-only). Renderer triggers `acceptModSync` IPC
   * to actually start the download. Not emitted when the host omitted the
   * mod manifest, when the joiner lacks the `modInventory` capability, or
   * when the diff is empty (everything already matches).
   */
  modSyncRequired: (info: {
    manifest: WelcomeModManifest
    diff: ModDiffResult
    downloadSizeBytes: number
    /**
     * Soft limit above which the renderer must show a confirm dialog
     * before calling `acceptModSync`. Default 500 MiB per §3 of the spec.
     */
    confirmThresholdBytes: number
    /** Convenience: `downloadSizeBytes > confirmThresholdBytes`. */
    confirmRequired: boolean
  }) => void
  /**
   * Tier 4 Phase 3 — host side. Emitted by `publishHostMods` to surface
   * any mods that were excluded from the manifest (paid / no-share /
   * server-only). UI shows a one-time notice so the host knows joiners
   * may see missing assets for objects depending on those mods.
   */
  modShareSkipped: (info: {
    skippedNoShareIds: string[]
    skippedServerOnlyIds: string[]
    publishedCount: number
  }) => void
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

  /**
   * Tier 4 Phase 3 mod sync (joiner side). The diff service is statically
   * constructed; the enumerator callback is set by the IPC layer because
   * the controller doesn't know how to resolve `userDir` on its own.
   * `null` enumerator effectively disables mod sync.
   */
  private readonly modSyncJoiner = new ModSyncJoinerService()
  private modEnumerator: (() => Promise<ModInfo[]>) | null = null
  /** Last manifest+diff received in welcome — kept around so the renderer
   *  can re-fetch via IPC and the download flow knows what to ask for. */
  private modSyncPending: {
    manifest: WelcomeModManifest
    diff: ModDiffResult
    downloadSizeBytes: number
  } | null = null
  private readonly modStaging = new CoopSessionStagingService()
  /** Resolves the joiner's BeamNG userDir for staging downloads. Set by IPC layer. */
  private userDirResolver: (() => string | null) | null = null
  /** Resolves the configured download confirm threshold (bytes). Set by IPC layer. */
  private modSyncThresholdResolver: (() => number) | null = null
  /** Stable session-scope tag used for the joiner's staging dir + db.json marker. */
  private joinerStagingTag: string | null = null
  /** Active mod-sync orchestration (one at a time per join). */
  private modSyncRun: { running: boolean; downloaded: string[] } | null = null

  /**
   * §D — per-peer undo stacks. Both stacks store entries the LOCAL author
   * created (not remote ops). `myOps` grows as `do`-kind envelopes flow
   * through `ingestLocalOp`; capped at MY_OPS_CAP via FIFO eviction so a
   * marathon session does not balloon memory. `myRedoStack` holds entries
   * that were popped by `undo()` and can be re-applied by `redo()`. Both
   * are session-scoped (cleared in `leave()`); persistence across reconnect
   * is Tier 6 territory per spec §D.5.
   *
   * Stored shape is the full `LuaOpEnvelope` we forwarded — that is the
   * smallest object that carries everything #22 (inverse derivation) and
   * #23 (create/delete special-case) need to rebuild the reverse op.
   */
  private static readonly MY_OPS_CAP = 1024
  private myOps: LuaOpEnvelope[] = []
  private myRedoStack: LuaOpEnvelope[] = []
  /**
   * Re-entry guard: undo()/redo() synthesises an inverse envelope and
   * pumps it through `ingestLocalOp` so it follows the exact same
   * broadcast + activity path as a real edit — but the stack push has
   * to be skipped or every undo would immediately become its own
   * undoable entry (and Ctrl+Z would oscillate).
   */
  private synthesisedUndoInFlight = false

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

  /**
   * IPC layer plugs in a callback that returns the joiner's local mod
   * library. Required for Tier 4 Phase 3 mod sync — without it, an
   * incoming `welcome.mods` is logged and ignored. Called once at startup.
   */
  setModEnumerator(fn: (() => Promise<ModInfo[]>) | null): void {
    this.modEnumerator = fn
  }

  /**
   * IPC layer plugs in a callback that returns the joiner's BeamNG userDir
   * for staging downloads. Required for mod sync — without it, accept will
   * no-op. Returning `null` means the joiner has no configured game path.
   */
  setUserDirResolver(fn: (() => string | null) | null): void {
    this.userDirResolver = fn
  }

  /**
   * IPC layer plugs in a callback returning the configured "ask before
   * downloading more than X bytes" threshold (from `AppConfig.worldEditSync
   * .modSync.confirmThresholdBytes`). Defaults to 500 MiB when unset.
   */
  setModSyncThresholdResolver(fn: (() => number) | null): void {
    this.modSyncThresholdResolver = fn
  }

  /** Most recent welcome.mods diff (for renderer queries). */
  getPendingModSync(): {
    manifest: WelcomeModManifest
    diff: ModDiffResult
    downloadSizeBytes: number
  } | null {
    return this.modSyncPending
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
      if (this.opsOut <= 3 || this.opsOut % 25 === 0) {
        console.log(`[EditorSync.host] relay→localLua #${this.opsOut} kind=${op.kind} name=${op.name} author=${op.authorId}`)
      }
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

  /**
   * Host-only: enumerate the local mod library, build a ModManifest, and
   * publish it on the relay so future joiners receive `welcome.mods`.
   * Filters out `multiplayerScope === 'server'` and `noShare === true`
   * entries up front (per §3 of the spec) and emits `modShareSkipped`
   * if any were dropped so the host UI can surface a one-time notice.
   *
   * `levelDependencies` is an optional list of mod filenames the current
   * level's `info.json` references — joiners prioritise those downloads.
   * Re-callable: each invocation rebuilds the share list and replaces the
   * advertised manifest.
   */
  async publishHostMods(opts: {
    beamngBuild: string
    levelDependencies?: string[]
  }): Promise<{ publishedCount: number; skippedNoShareIds: string[]; skippedServerOnlyIds: string[] }> {
    if (!this.relay) {
      throw new Error('publishHostMods called when not hosting')
    }
    if (!this.modEnumerator) {
      throw new Error('publishHostMods called without modEnumerator wired')
    }
    const localMods = await this.modEnumerator()
    const skippedServerOnlyIds = localMods
      .filter((m) => m.multiplayerScope === 'server')
      .map((m) => m.key)
    const inv = new ModInventoryService()
    const { manifest, skippedNoShare } = await inv.buildManifest(
      localMods,
      (m) => m.filePath,
      opts.beamngBuild,
      opts.levelDependencies ?? [],
    )
    // Hand off to the relay: HTTP share list (id → zip) + welcome manifest.
    const httpCoords = await this.relay.setModShareList(
      manifest.entries.map((e) => {
        const local = localMods.find((m) => m.key === e.id)
        return {
          id: e.id,
          fileName: e.fileName,
          zipPath: local?.filePath ?? '',
          sha256: e.sha256,
          sizeBytes: e.sizeBytes,
        }
      }),
    )
    this.relay.setActiveModManifest({
      beamngBuild: manifest.beamngBuild,
      levelDependencies: manifest.levelDependencies,
      entries: manifest.entries,
      httpPort: httpCoords.httpPort,
      authToken: httpCoords.authToken,
    })
    const summary = {
      publishedCount: manifest.entries.length,
      skippedNoShareIds: skippedNoShare,
      skippedServerOnlyIds,
    }
    this.log(
      'info',
      'session',
      `mod manifest published: ${summary.publishedCount} entries, ` +
        `${summary.skippedNoShareIds.length} no-share skipped, ` +
        `${summary.skippedServerOnlyIds.length} server-only skipped`,
    )
    if (summary.skippedNoShareIds.length > 0 || summary.skippedServerOnlyIds.length > 0) {
      this.emit('modShareSkipped', summary)
    }
    return summary
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
      if (this.opsOut <= 3 || this.opsOut % 25 === 0) {
        console.log(`[EditorSync.joiner] peer→localLua #${this.opsOut} kind=${op.kind} name=${op.name} author=${op.authorId}`)
      }
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

    // Tier 4 Phase 3 mod sync: host responded to our `MissingModsRequest`
    // with one offer per id. Each offer is processed sequentially by the
    // active mod-sync run; if no run is active (offer arrived after we
    // already gave up / cancelled), we just log and ignore.
    client.on('modOffer', (offer) => {
      if (!this.modSyncRun || !this.modSyncRun.running) {
        this.log('warn', 'session', `Ignoring stale mod offer for ${offer.id}`)
        return
      }
      this.processModOffer(offer).catch((err) => {
        this.log('warn', 'session', `mod download for ${offer.id} failed: ${(err as Error).message}`)
      })
    })

    // Phase 3 — host streams a snapshot to us as snapshotBegin/Chunk*/End.
    // Forward chunks straight to local Lua for reassembly + apply. The Lua
    // side acks via Z| frames; the launcher surfaces them via the
    // snapshotApplied listener (wired below) which we forward back to host.
    client.on('snapshotBegin', (msg) => {
      this.log('info', 'snapshot', `Receiving snapshot ${msg.snapshotId.substring(0, 8)} (${msg.total} chunks, ${msg.byteLength} B, baseSeq=${msg.baseSeq})`)
    })
    client.on('snapshotChunk', (msg) => {
      // §E.34 — host MAY zlib-compress chunks above the threshold.
      // Decompress here so the local Lua side stays oblivious to the
      // wire-format optimisation. Any failure is fatal for the snapshot
      // (we can't recover a single missing chunk), so log + drop and let
      // the host's snapshot retry path rebuild from scratch.
      let payload = msg.payload
      if (msg.compressed === 'deflate-raw') {
        try {
          const buf = inflateRawSync(Buffer.from(msg.payload, 'base64'))
          payload = buf.toString('utf8')
        } catch (e) {
          this.log('error', 'snapshot',
            `Failed to inflate snapshot chunk ${msg.index}/${msg.total} of ${msg.snapshotId.substring(0, 8)}: ${(e as Error).message}`)
          return
        }
      }
      this.gameLauncher.sendEditorSnapshotChunk({
        snapshotId: msg.snapshotId,
        index: msg.index,
        total: msg.total,
        payload,
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
      // Tier 4 Phase 3: if the host advertised a mod manifest, run the
      // diff and tell the renderer. Best-effort — failure here doesn't
      // block the session, the user just won't see the mod-sync prompt.
      if (welcome.mods) {
        this.handleWelcomeMods(welcome.mods).catch((err) => {
          this.log('warn', 'session', `mod sync diff failed: ${(err as Error).message}`)
        })
      } else {
        this.modSyncPending = null
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
    // Priority order for the level to boot into:
    //   1. Explicit `levelOverride` from the caller (e.g. joiner's auto-launch
    //      after project download hands in `_beamcm_projects/<folder>`).
    //   2. The currently-advertised / -offered coop project — boot straight
    //      into its own map so a host clicking "Launch into editor" always
    //      lands in the same world as any connected peers, regardless of
    //      whatever unrelated level the bridge last reported.
    //   3. The bridge-reported level name (what BeamNG is currently sitting
    //      on if the game is already running).
    let level = opts.levelOverride ?? null
    if (!level && this.activeProject && this.activeProject.folder) {
      // VFS sub-path form that `launchVanilla` appends `.../info.json` onto.
      level = `_beamcm_projects/${this.activeProject.folder}`
      this.log(
        'info',
        'session',
        `prepareEditorLaunch: using active coop project "${this.activeProject.name}" → ${level}`,
      )
    }
    if (!level) {
      level = this.normalizeLevelName(this.levelName)
    }
    if (!level) {
      return {
        level: null,
        error:
          'No level known for this session yet. Either the host has not loaded a level or the bridge has not reported one.',
      }
    }
    // Ensure the editor-sync extension is on disk BEFORE the game starts so
    // BeamNG auto-loads it on launch. Without this, `editor_autostart.json`
    // below gets written but nothing ever reads it → the editor never opens
    // and the player sits in plain freeroam (or, depending on BeamMP mod
    // load ordering, stays in the main menu). deployEditorSync is idempotent
    // and also writes `editorsync_signal.json = {action:'load'}`, which
    // covers the "game already running" case via the bridge's hot-load poll.
    try {
      const deploy = this.gameLauncher.deployEditorSync(opts.userDir)
      if (!deploy.success) {
        this.log(
          'warn',
          'session',
          `deployEditorSync failed (editor may not auto-open): ${deploy.error ?? 'unknown'}`,
        )
      }
    } catch (err) {
      this.log('warn', 'session', `deployEditorSync threw: ${err}`)
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
    if (info) {
      // Project's level is authoritative now — snap our adopted levelName
      // to it in case a transient pose frame already adopted the wrong
      // value before the project was registered. Future poses won't
      // overwrite this thanks to the activeProject guard in ingestLocalPose.
      const projectLevel = `levels/_beamcm_projects/${info.folder}/info.json`
      if (this.levelName !== projectLevel) {
        this.levelName = projectLevel
        this.relay.setLevelName(projectLevel)
      }
    }
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
   * §E.3 — pass-through accessors for the WorldSaveService writer. Keep
   * the relay private; callers go through these so the surface area
   * stays stable across §F refactors. All return null when the
   * controller is not in `hosting` state.
   */
  getCurrentSnapshotBytes(): ReturnType<EditorSyncRelayService['getCurrentSnapshotBytes']> {
    return this.relay?.getCurrentSnapshotBytes() ?? null
  }
  getActiveModManifest(): ReturnType<EditorSyncRelayService['getActiveModManifest']> {
    return this.relay?.getActiveModManifest() ?? null
  }
  getRecentOps(): ReturnType<EditorSyncRelayService['getRecentOps']> {
    return this.relay?.getRecentOps() ?? []
  }
  /**
   * §E.4 — seed the relay's snapshot + op log from a freshly loaded
   * `.beamcmworld`. Returns true if the relay accepted the seed
   * (i.e. we're hosting); false if there's no relay to feed (caller
   * should host first, then re-call).
   */
  seedSavedWorld(input: { snapshotBytes: Buffer | null; ops: OpMsg[]; levelName: string | null }): boolean {
    if (!this.relay) return false
    this.relay.seedSavedWorld(input)
    return true
  }
  /**
   * §E.3 — request a fresh snapshot build from the host Lua. Used by
   * solo saves so a host with no joiner can still capture the current
   * scene to a `.beamcmworld`. Returns null if there's no relay
   * (i.e. not hosting); rejects on bridge / timeout failures.
   */
  async forceSnapshotBuild(timeoutMs?: number): Promise<{
    bytes: Buffer
    levelName: string | null
    baseSeq: number
    createdTs: number
  } | null> {
    if (!this.relay) return null
    return this.relay.forceSnapshotBuild(timeoutMs)
  }
  /** Best-effort current level identifier (host or joiner side). */
  getLevelName(): string | null {
    return this.levelName
  }
  /** Local author UUID (used to seed contributor list when saving solo). */
  getAuthorId(): string {
    return this.authorId
  }
  /** Local display name (BeamMP username when known). */
  getDisplayName(): string {
    return this.displayName
  }
  /** Stable per-session UUID — promoted to `worldId` on first save. */
  getSessionId(): string | null {
    return this.sessionId
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

  /**
   * Tier 4 Phase 3 mod sync — joiner side. Hashes the local mod library,
   * runs the diff against the manifest the host advertised, stashes the
   * result on the controller for renderer queries, and emits
   * `modSyncRequired` if any download or attention is needed. Skips the
   * emit when nothing is missing/drift/local-only — silent success.
   */
  private async handleWelcomeMods(welcomeMods: WelcomeModManifest): Promise<void> {
    if (!this.modEnumerator) {
      this.log('warn', 'session', 'welcome.mods received but no mod enumerator wired')
      return
    }
    const localMods = await this.modEnumerator()
    const manifest: ModManifest = {
      beamngBuild: welcomeMods.beamngBuild,
      levelDependencies: welcomeMods.levelDependencies,
      // WelcomeModManifestEntry is a structural superset (same shape),
      // so the cast is safe and avoids an explicit field-by-field copy.
      entries: welcomeMods.entries,
    }
    const result = await this.modSyncJoiner.runDiff(manifest, localMods)
    this.modSyncPending = {
      manifest: welcomeMods,
      diff: result.diff,
      downloadSizeBytes: result.downloadSizeBytes,
    }
    const summary =
      `${result.diff.exactMatchIds.length} exact / ` +
      `${result.diff.missingIds.length} missing / ` +
      `${result.diff.driftIds.length} drift / ` +
      `${result.diff.localOnlyIds.length} local-only` +
      (result.downloadSizeBytes > 0
        ? ` (~${Math.round(result.downloadSizeBytes / (1024 * 1024))} MiB)`
        : '')
    this.log('info', 'session', `host mod manifest: ${summary}`)
    const needsAttention =
      result.diff.missingIds.length > 0 ||
      result.diff.driftIds.length > 0 ||
      result.diff.localOnlyIds.length > 0
    if (needsAttention) {
      const confirmThresholdBytes =
        this.modSyncThresholdResolver?.() ?? 500 * 1024 * 1024
      this.emit('modSyncRequired', {
        manifest: welcomeMods,
        diff: result.diff,
        downloadSizeBytes: result.downloadSizeBytes,
        confirmThresholdBytes,
        confirmRequired: result.downloadSizeBytes > confirmThresholdBytes,
      })
    }
  }

  /**
   * Tier 4 Phase 3: renderer-driven entry point that begins the actual
   * mod-download flow. Sends a `MissingModsRequest` to the host; offers
   * stream back via the `modOffer` listener and are processed in
   * `processModOffer`. Caller is expected to have shown a confirm dialog
   * already (the renderer enforces the size threshold from #21).
   *
   * No-op when there's nothing to download (i.e. only drift / local-only
   * entries — those are handled by the renderer's UI directly).
   */
  async acceptModSync(): Promise<void> {
    const pending = this.modSyncPending
    if (!pending) {
      this.log('warn', 'session', 'acceptModSync called with no pending diff')
      return
    }
    if (this.modSyncRun?.running) {
      this.log('warn', 'session', 'mod sync already running')
      return
    }
    if (!this.peer) {
      this.log('warn', 'session', 'acceptModSync called before peer connected')
      return
    }
    if (!this.userDirResolver) {
      this.log('warn', 'session', 'acceptModSync: no userDir resolver wired')
      return
    }
    const userDir = this.userDirResolver()
    if (!userDir) {
      this.log('warn', 'session', 'acceptModSync: BeamNG userDir not configured')
      return
    }
    if (pending.diff.missingIds.length === 0) {
      // Nothing to download — confirm to host immediately so it can open
      // the snapshot gate without waiting on us.
      this.peer.sendModsInstalled(pending.diff.exactMatchIds, pending.diff.localOnlyIds)
      this.log('info', 'session', 'mod sync: nothing to download, signalling installed')
      return
    }
    // Mint a stable staging tag for this run; tied to host authorId so a
    // re-join into the same session can re-use the existing folder if any
    // partial downloads survived a crash.
    this.joinerStagingTag = randomUUID().substring(0, 8)
    await this.modStaging.ensureStagingDir(userDir, this.joinerStagingTag)
    this.modSyncRun = { running: true, downloaded: [] }
    this.log('info', 'session', `mod sync: requesting ${pending.diff.missingIds.length} mod(s) from host`)
    const ok = this.peer.sendMissingModsRequest(pending.diff.missingIds)
    if (!ok) {
      this.modSyncRun = null
      this.log('error', 'session', 'failed to send MissingModsRequest')
    }
  }

  /**
   * Process one `ModOffer` by downloading the zip into the joiner's
   * staging dir, registering it in `db.json`, and — when every requested
   * id has been received — emitting `ModsInstalled` to the host.
   */
  private async processModOffer(offer: {
    id: string; url: string; sha256: string; sizeBytes: number; fileName: string
  }): Promise<void> {
    const pending = this.modSyncPending
    const run = this.modSyncRun
    if (!pending || !run || !this.userDirResolver || !this.joinerStagingTag) return
    const userDir = this.userDirResolver()
    if (!userDir) return
    const sessionTag = this.joinerStagingTag
    const destPath = this.modStaging.destPathFor(userDir, sessionTag, offer.fileName)
    // Skip the download if a previous run already placed the bytes (e.g.
    // a retry after a transient network blip); verify hash before trusting.
    const alreadyStaged = await this.modStaging.hasStaged(userDir, sessionTag, offer.fileName, offer.sizeBytes)
    if (!alreadyStaged) {
      try {
        await this.modSyncJoiner.downloadOffer(offer, destPath)
      } catch (httpErr) {
        // §E.33 — HTTP path unreachable (firewall blocking adjacent
        // ports, host's HTTP failed to bind, etc.). Fall back to
        // streaming over the existing session TCP socket. Slower but
        // works whenever the session itself works.
        this.log('warn', 'session',
          `mod ${offer.id}: HTTP download failed (${(httpErr as Error).message}); ` +
          `falling back to TCP stream`)
        await this.downloadModOverTcp(offer, destPath)
      }
    }
    const ok = await this.modSyncJoiner.verifyOnDisk(destPath, offer.sha256)
    if (!ok) {
      this.log('warn', 'session', `mod ${offer.id}: post-download sha256 mismatch — refusing to register`)
      return
    }
    // Find the manifest entry to grab the metadata for db.json registration.
    const manifestEntry = pending.manifest.entries.find((e) => e.id === offer.id)
    if (!manifestEntry) {
      this.log('warn', 'session', `mod ${offer.id}: no matching manifest entry, skipping db.json register`)
      return
    }
    await this.modStaging.registerStagedMod(userDir, sessionTag, {
      key: manifestEntry.id,
      fileName: manifestEntry.fileName,
      modType: manifestEntry.modType,
      sizeBytes: manifestEntry.sizeBytes,
      title: manifestEntry.title,
      version: manifestEntry.version,
      resourceId: manifestEntry.resourceId,
    })
    run.downloaded.push(offer.id)
    this.log('info', 'session', `mod ${offer.id}: staged (${run.downloaded.length}/${pending.diff.missingIds.length})`)
    if (run.downloaded.length >= pending.diff.missingIds.length) {
      run.running = false
      const presentIds = [...pending.diff.exactMatchIds, ...run.downloaded]
      this.peer?.sendModsInstalled(presentIds, pending.diff.localOnlyIds)
      this.log('info', 'session', `mod sync complete: ${presentIds.length} present, ${pending.diff.localOnlyIds.length} disabled`)
      // Trigger in-game live reload via the Lua bridge. If BeamNG isn't
      // running yet (joiner will launch after modsInstalled), this is a
      // no-op and the mods will be picked up normally at boot.
      if (this.userDirResolver && this.joinerStagingTag) {
        const userDir = this.userDirResolver()
        if (userDir) {
          const stagingDir = this.modStaging.stagingDir(userDir, this.joinerStagingTag)
          const payload = run.downloaded.map((id) => {
            const e = pending.manifest.entries.find((x) => x.id === id)
            return { key: id, fullpath: e ? `${stagingDir}/${e.fileName}` : stagingDir }
          })
          const ok = this.gameLauncher.sendEditorModReload(payload)
          if (!ok) {
            this.log('info', 'session', 'mod live-reload skipped: editor bridge not up yet (will load on next launch)')
          }
        }
      }
    }
  }

  /**
   * §E.33 — TCP fallback for mod download. Asks the host to stream
   * `id`'s zip bytes over the existing session socket (HTTP unreachable
   * scenario). Resolves when `modEnd{ok:true}` arrives + sha256 matches;
   * rejects on `modEnd{ok:false}`, mismatch, or socket close.
   *
   * Listeners are scoped to this single transfer — we attach `modChunk`
   * + `modEnd` listeners only for `id`, then remove them on settle. A
   * second concurrent call for the same id would currently confuse the
   * host (one transfer, two writers); we don't support that today and
   * the caller path (`processModOffer`) only ever runs one offer at a
   * time per id.
   */
  private async downloadModOverTcp(
    offer: { id: string; sha256: string; sizeBytes: number; fileName: string },
    destPath: string,
  ): Promise<void> {
    if (!this.peer) throw new Error('TCP mod fallback: no active peer client')
    await mkdir(dirname(destPath), { recursive: true })
    return new Promise<void>((resolve, reject) => {
      const out = createWriteStream(destPath)
      const hash = createHash('sha256')
      let received = 0
      let lastIndex = -1
      let settled = false

      const cleanup = () => {
        this.peer?.off('modChunk', onChunk)
        this.peer?.off('modEnd', onEnd)
      }
      const fail = (err: Error) => {
        if (settled) return
        settled = true
        cleanup()
        try { out.destroy() } catch { /* ignore */ }
        unlink(destPath).catch(() => { /* ignore */ })
        reject(err)
      }

      const onChunk = (chunk: { id: string; index: number; total: number; payload: string }) => {
        if (chunk.id !== offer.id) return
        // Strict ordering: TCP delivers in-order, so any gap means the
        // host skipped a chunk → bail rather than corrupt the file.
        if (chunk.index !== lastIndex + 1) {
          fail(new Error(`mod ${offer.id}: out-of-order chunk ${chunk.index} (expected ${lastIndex + 1})`))
          return
        }
        lastIndex = chunk.index
        try {
          const buf = Buffer.from(chunk.payload, 'base64')
          hash.update(buf)
          received += buf.length
          out.write(buf)
        } catch (e) {
          fail(new Error(`mod ${offer.id}: chunk decode failed: ${(e as Error).message}`))
        }
      }
      const onEnd = (msg: { id: string; ok: boolean; error?: string; sha256: string; sizeBytes: number }) => {
        if (msg.id !== offer.id) return
        if (!msg.ok) {
          fail(new Error(msg.error ?? 'host aborted TCP mod transfer'))
          return
        }
        if (received !== msg.sizeBytes) {
          fail(new Error(`mod ${offer.id}: size mismatch (got ${received}, expected ${msg.sizeBytes})`))
          return
        }
        settled = true
        cleanup()
        out.end(() => {
          const got = hash.digest('hex')
          if (got !== msg.sha256) {
            unlink(destPath).catch(() => { /* ignore */ })
            reject(new Error(`mod ${offer.id}: sha256 mismatch (got ${got}, expected ${msg.sha256})`))
            return
          }
          resolve()
        })
      }

      this.peer!.on('modChunk', onChunk)
      this.peer!.on('modEnd', onEnd)
      const sent = this.peer!.sendModRequest(offer.id)
      if (!sent) {
        fail(new Error('failed to send modRequest (peer disconnected?)'))
      }
    })
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
    // Tier 4 Phase 3 mod sync cleanup — remove any coop-session mods we
    // staged for this join and strip their db.json entries. Best-effort;
    // leftover files are recoverable by the user from the multiplayer
    // folder. Only runs on the joiner side (`joinerStagingTag` set).
    if (this.joinerStagingTag && this.userDirResolver) {
      const userDir = this.userDirResolver()
      if (userDir) {
        this.modStaging.cleanupSession(userDir, this.joinerStagingTag).catch((err) => {
          this.log('warn', 'session', `mod staging cleanup failed: ${(err as Error).message}`)
        })
      }
    }
    this.joinerStagingTag = null
    this.modSyncPending = null
    this.modSyncRun = null
    // §D.5: undo/redo stacks are session-scoped — drop them on disconnect.
    this.myOps = []
    this.myRedoStack = []
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
    if (this.opsIn <= 3 || this.opsIn % 25 === 0) {
      console.log(`[EditorSync.local] ingestLocalOp #${this.opsIn} state=${this.state} kind=${env.kind} name=${env.name}`)
    }
    // Record as local-user activity so the UI can show "You: Move (42s ago)".
    this.recordActivity({
      authorId: this.authorId,
      displayName: this.displayName,
      ts: Date.now(),
      kind: env.kind,
      name: env.name,
      detail: env.detail,
    })
    // §D.1–2: track our own `do` ops on the per-peer stack and clear the
    // redo stack on any fresh user action — same semantics every undo
    // implementation uses (Figma, Word, BeamNG's own native history).
    // We deliberately do NOT push `undo`/`redo` envelopes: those will be
    // synthesized by undo()/redo() below and re-enter ingestLocalOp via
    // the same path; the `synthesisedUndo` re-entry flag suppresses the
    // myOps push and the redo-stack reset for those cases.
    if (env.kind === 'do' && !this.synthesisedUndoInFlight) {
      this.myOps.push(env)
      if (this.myOps.length > EditorSyncSessionController.MY_OPS_CAP) {
        // FIFO eviction — losing the oldest end of history is the standard
        // bounded-undo trade-off; MY_OPS_CAP=1024 is roughly an hour of
        // continuous editing at 1 commit/4 s.
        this.myOps.shift()
      }
      if (this.myRedoStack.length > 0) this.myRedoStack = []
    }
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

  /* ── §D Undo / Redo (per-peer command-pattern) ───────────────────── */

  /**
   * Pop the local user's most recent `do`, build its inverse, and broadcast
   * the inverse as a fresh `do` op so every peer (including ourselves)
   * applies it through the regular commitAction path. The inverse is
   * pushed onto `myRedoStack` so a Ctrl+Y re-flips it. Returns a small
   * descriptor for the renderer to surface the first-time-seen toast
   * mandated by §D.3 ("may discard concurrent changes by others").
   */
  undo(): { ok: boolean; reason?: string; name?: string } {
    if (this.state === 'idle') return { ok: false, reason: 'no-session' }
    if (this.myOps.length === 0) return { ok: false, reason: 'empty-stack' }
    // We pop optimistically; if the inverter returns null we restore the
    // entry so the user can retry with a different action.
    const top = this.myOps.pop() as LuaOpEnvelope
    const inverse = buildInverseOp(top)
    if (!inverse) {
      this.myOps.push(top)
      this.log('warn', 'session', `Cannot invert action "${top.name ?? '?'}" (#22 coverage gap)`)
      return { ok: false, reason: 'unsupported', name: top.name }
    }
    this.myRedoStack.push(top)
    this.broadcastSynthesised(inverse)
    return { ok: true, name: top.name }
  }

  /**
   * Re-broadcast the original `do` envelope sitting on top of the redo
   * stack. The matching `undo()` already handed the world back to its
   * pre-edit state via the inverse op; replaying the original brings
   * it forward again.
   */
  redo(): { ok: boolean; reason?: string; name?: string } {
    if (this.state === 'idle') return { ok: false, reason: 'no-session' }
    if (this.myRedoStack.length === 0) return { ok: false, reason: 'empty-stack' }
    const top = this.myRedoStack.pop() as LuaOpEnvelope
    // The original `do` envelope reasserts the post-state — re-broadcast
    // it directly (we kept it intact when we pushed onto myRedoStack).
    this.myOps.push(top)
    // Re-emit with a fresh clientOpId so the relay/peer treats it as a
    // distinct op and acks it independently. We do NOT clear the redo
    // stack here because the user's intent is "go forward through
    // history", not "start a new branch".
    const reissue: LuaOpEnvelope = { ...top, clientOpId: randomUUID(), ts: Date.now() }
    this.broadcastSynthesised(reissue, /* keepRedoStack */ true)
    return { ok: true, name: top.name }
  }

  /**
   * Pump an envelope through the same broadcast path as a real edit
   * without disturbing myOps/myRedoStack. The activity panel still
   * gets a row so peers see "you: undo Move" in the live feed.
   */
  private broadcastSynthesised(env: LuaOpEnvelope, keepRedoStack = false): void {
    this.synthesisedUndoInFlight = true
    try {
      // Force-keep the redo stack across this re-entry by snapshotting
      // it pre-call and restoring afterwards if requested. The
      // ingestLocalOp guard already skips the myOps push, but the
      // "fresh do clears redo" rule fires unconditionally — undo()
      // wants the redo entry to stay so the user can keep walking.
      const redoBackup = keepRedoStack ? this.myRedoStack.slice() : null
      this.ingestLocalOp(env)
      if (redoBackup) this.myRedoStack = redoBackup
    } finally {
      this.synthesisedUndoInFlight = false
    }
  }

  /** Read-only stack depths for renderer button enable/disable. */
  getUndoDepths(): { undo: number; redo: number } {
    return { undo: this.myOps.length, redo: this.myRedoStack.length }
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
    // the right `welcome.levelName`. BUT: if we have an active coop project
    // (advertised via setActiveProject), the project's levelName is
    // authoritative — don't let a transient pose frame (e.g. from the
    // freeroam menu before the editor loaded the coop project) overwrite
    // it. Pose frames are observational; only explicit setActiveProject /
    // setLevelName changes should move the advertised level.
    const activeProject = this.relay?.getActiveProject()
    if (
      this.state === 'hosting' &&
      this.relay &&
      pose.levelName &&
      this.levelName !== pose.levelName &&
      !activeProject
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
