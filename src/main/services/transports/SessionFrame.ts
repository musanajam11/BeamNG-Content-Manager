/**
 * Framing helpers for the CM-to-CM session transport.
 *
 * Wire format: 4-byte big-endian unsigned length prefix + UTF-8 JSON payload.
 * This is used by both `EditorSyncRelayService` (host side, accepts peers)
 * and `PeerClient` (joiner side, dials host).
 *
 * Max payload: 2 MiB (late-join baseline chunks are split below this).
 */

import { Socket } from 'net'

export const MAX_FRAME_BYTES = 2 * 1024 * 1024

export type SessionMessage =
  | HelloMsg
  | WelcomeMsg
  | OpMsg
  | AckMsg
  | LeaveMsg
  | PingMsg
  | PongMsg
  | ErrorMsg
  | PoseMsg
  | EnvMsg
  | FieldMsg
  | SnapshotBeginMsg
  | SnapshotChunkMsg
  | SnapshotEndMsg
  | SnapshotAppliedMsg
  | SnapshotRequestMsg
  | BrushMsg
  | ProjectOfferMsg

export interface HelloMsg {
  type: 'hello'
  protocol: 1
  authorId: string
  displayName?: string
  token?: string
  fromSeq?: number
  /**
   * Optional BeamMP username the joiner authenticates as. Used by the host's
   * `friends`-mode whitelist. Not cryptographically verified — the joiner's
   * CM says who they are, and the host either trusts that (friends-whitelist)
   * or falls back to the other auth modes (token / approval).
   */
  beamUsername?: string
}

export interface WelcomeMsg {
  type: 'welcome'
  authorId: string            // the host's own authorId
  yourAuthorId: string        // assigned to the joiner (echoes hello.authorId)
  peers: Array<{ authorId: string; displayName?: string }>
  lastSeq: number
  levelName?: string | null
  /**
   * Hint about where the level came from so the joiner can decide whether to
   * prompt the user to install a mod. Optional / best-effort; if absent, the
   * joiner just looks at `levelName` alone.
   */
  levelSource?: {
    /** True if this is a built-in BeamNG level shipped with the game. */
    builtIn: boolean
    /** Optional mod file path / url on host side for diagnostics only. */
    modPath?: string
    /** Optional content hash so two installs can be compared for drift. */
    hash?: string
  }
  /**
   * Phase-1 env-channel cold-join payload. Snapshot of the host's current
   * scene globals (ToD, weather, gravity, sim speed, fog, water, …) so a
   * joiner immediately sees the right state instead of "stock level".
   * Each entry is the most recent EnvMsg observed by the relay for that key.
   * Tiny — tens of bytes per key, ~6 keys typical.
   */
  env?: Array<EnvCacheEntry>
  /**
   * Optional: host is offering a saved editor project for the joiner to
   * download + load locally so both sides start from the same map state.
   * When present, the joiner UI shows a banner prompting the user to accept;
   * fetching happens over a separate HTTP listener on the host at the port
   * advertised here.
   */
  project?: WelcomeProjectInfo
}

/**
 * Subset of the host's active-project metadata included in the Welcome
 * frame so joiners can decide whether to download. Matches the joiner-
 * facing `SessionProjectInfo` 1:1 except for field naming (kept short to
 * minimize welcome payload).
 */
export interface WelcomeProjectInfo {
  name: string
  levelName: string
  folder: string
  sha256: string
  sizeBytes: number
  httpPort: number
}

/**
 * Mid-session project update. Sent by the host to every already-connected
 * peer whenever `setActiveProject` mints a new zip (user explicitly swapped
 * the shared project, or auto-provision picked a different folder). Joiners
 * compare the incoming `sha256` to their installed project and re-download
 * only on mismatch.
 */
export interface ProjectOfferMsg {
  type: 'projectOffer'
  project: WelcomeProjectInfo
}

/** Single entry in `WelcomeMsg.env` and the relay's env cache. */
export interface EnvCacheEntry {
  key: string
  value: unknown
  authorId: string
  ts: number
}

export interface OpMsg {
  type: 'op'
  seq: number
  authorId: string
  clientOpId?: string
  kind: 'do' | 'undo' | 'redo'
  name?: string
  data?: unknown
  detail?: string
  targets?: unknown[]
  ts?: number
}

export interface AckMsg {
  type: 'ack'
  clientOpId: string
  seq: number
  status: 'ok' | string
}

export interface LeaveMsg {
  type: 'leave'
  authorId: string
  reason?: string
}

export interface PingMsg { type: 'ping'; ts: number }
export interface PongMsg { type: 'pong'; ts: number }
export interface ErrorMsg { type: 'error'; code: string; message: string }

/**
 * Ephemeral peer-presence update. Not sequenced, not logged, not ack'd.
 * Relay rebroadcasts to other peers; last-write-wins per `authorId`.
 * Sent at ~5 Hz while a peer is active in the editor.
 */
export interface PoseMsg {
  type: 'pose'
  authorId: string
  displayName?: string
  /** Wall-clock ms (sender side). */
  ts: number
  /** Camera / vehicle position in world space. */
  x: number
  y: number
  z: number
  /** Heading in radians (yaw), if known. */
  heading?: number
  /** `true` when the peer is currently driving a vehicle. */
  inVehicle?: boolean
  /** Vehicle display name ("etk800", "pickup", …) if inVehicle. */
  vehicle?: string
  /** Currently loaded level name — for mismatch detection. */
  levelName?: string | null
}

/**
 * Scene-globals channel. One message per changed key (ToD, weather, gravity,
 * sim speed, fog, water, …). Last-write-wins per `key`, deterministic
 * tiebreak on `(ts, authorId)` lexicographically. Not sequenced (no `seq`),
 * not logged to `ops.log`, not entered into the per-author undo stack —
 * mirrors how BeamNG itself treats these settings.
 *
 * Lua-side capture/apply: see `cmPollEnv` / `applyRemoteEnv` in
 * EDITOR_SYNC_GE_LUA.
 */
export interface EnvMsg {
  type: 'env'
  authorId: string
  /** Wall-clock ms (sender side). LWW tiebreak. */
  ts: number
  /** One of the registered ENV_KEYS, e.g. "tod", "weather", "gravity". */
  key: string
  /** Opaque to the relay; key-specific shape (number, string, table). */
  value: unknown
}

/**
 * Per-object dynamic field write (Phase 2 field channel). Captures inspector
 * panel writes and any `obj:setField` calls that don't pass through
 * `editor.history`. LWW per `(pid, fieldName)` with `(ts, authorId)` tiebreak;
 * relay does not currently key on `arrayIndex` (covers all TRACKED_FIELDS use
 * cases — promote to per-arrayIndex if needed later).
 *
 * Lua-side capture/apply: see `cmSetField`, `cmPollFields`, `applyRemoteField`
 * in EDITOR_SYNC_GE_LUA.
 */
export interface FieldMsg {
  type: 'field'
  authorId: string
  ts: number
  /** Target object's BeamNG persistentId (UUID string, stable across save/load). */
  pid: string
  fieldName: string
  /** Default 0 — only relevant for vector/array-typed fields. */
  arrayIndex: number
  /** Opaque to the relay; field-specific shape (number, string, color3f, …). */
  value: unknown
}

/* ── Phase 3 — Snapshot exchange ───────────────────────────────────────────
 *
 * Cold-join + persistence. A snapshot is an opaque JSON blob (env cache +
 * field cache + later: touched objects, brush deltas) chunked over the
 * session socket. The host produces one via the Lua bridge (Z|→Y|), caches
 * it, and forwards it to every late-joining peer between Welcome and
 * live-op delivery.
 *
 * Wire framing (host→joiner):
 *   SnapshotBegin → SnapshotChunk × N → SnapshotEnd → joiner replies
 *   SnapshotApplied. The relay queues live ops for that joiner until the
 *   ack arrives, so they never see "ops on top of stale baseline".
 */

/**
 * Marker frame: a snapshot transfer is starting. Followed by `total`
 * SnapshotChunkMsg frames (indexed 0..total-1) and a single SnapshotEndMsg.
 */
export interface SnapshotBeginMsg {
  type: 'snapshotBegin'
  snapshotId: string
  /** Op `seq` the snapshot is anchored to; ops with greater seq replay on top. */
  baseSeq: number
  /** Total number of chunks the joiner should expect. */
  total: number
  /** Total uncompressed payload bytes (advisory; for progress UIs). */
  byteLength: number
  /** Snapshot kind — currently always "composite" (env+fields+objects). */
  kind: 'composite'
  levelName?: string | null
  /** Wall-clock ms when the host built the snapshot. */
  createdTs: number
}

export interface SnapshotChunkMsg {
  type: 'snapshotChunk'
  snapshotId: string
  /** Zero-based chunk index. */
  index: number
  /** Total count repeated for resilience to reordered streams. */
  total: number
  /** Slice of the JSON payload as a UTF-8 string. */
  payload: string
}

export interface SnapshotEndMsg {
  type: 'snapshotEnd'
  snapshotId: string
}

/**
 * Joiner→host acknowledgement: snapshot fully applied, ready for live ops.
 * Host removes the joiner from its "snapshot-pending" gate and starts
 * forwarding ops + env/field deltas as normal.
 */
export interface SnapshotAppliedMsg {
  type: 'snapshotApplied'
  snapshotId: string
  /** True when the apply succeeded; on false, host MAY retry or kick. */
  ok: boolean
  /** Optional error string when ok=false. */
  error?: string
}

/**
 * Joiner→host: "I think I've diverged, please send me a fresh snapshot."
 * Sent automatically after a long apply-queue stall (e.g. ops referencing
 * pids the joiner doesn't have for >snapshotInterval seconds).
 */
export interface SnapshotRequestMsg {
  type: 'snapshotRequest'
  /** Last seq the joiner is confident it has applied cleanly. */
  lastGoodSeq: number
  reason?: string
}

/* ── Phase 4 — Brush streams ───────────────────────────────────────────────
 *
 * Continuous brush gestures (terrain height, terrain paint, forest paint,
 * decal-road brush) wrapped as a Begin → Tick* → End triple keyed by
 * `strokeId`. Capped at 30 Hz per stroke. Not sequenced, not journalled
 * tick-by-tick; the originator emits a single synthesized op on End so the
 * undo history shows one entry. Snapshot accumulates per-tile/per-cell
 * deltas via folded `finalSummary` payloads.
 *
 * Lua-side capture/apply: see `cmBrushBegin` / `cmBrushTick` / `cmBrushEnd`
 * helpers + `applyRemoteBrush` in EDITOR_SYNC_GE_LUA.
 */
export interface BrushMsg {
  type: 'brush'
  authorId: string
  ts: number
  strokeId: string
  /**
   * 'begin' opens a stroke (peers spin up an apply context),
   * 'tick' streams per-frame deltas (capped 30 Hz),
   * 'end' closes the stroke and carries `finalSummary` for snapshot folding.
   */
  kind: 'begin' | 'tick' | 'end'
  /**
   * Brush family. Apply path is dispatched on this. Currently:
   *   'terrainHeight' | 'terrainPaint' | 'forestPaint' | 'decalRoadBrush'
   * Forward-compat: peers ignore unknown brushTypes silently.
   */
  brushType: string
  /** Opaque to the relay; brushType+kind-specific shape. */
  payload: unknown
}

/** Encode one message to a length-prefixed frame buffer. */
export function encodeFrame(msg: SessionMessage): Buffer {
  const json = Buffer.from(JSON.stringify(msg), 'utf8')
  if (json.length > MAX_FRAME_BYTES) {
    throw new Error(`SessionTransport: frame too large (${json.length} > ${MAX_FRAME_BYTES})`)
  }
  const out = Buffer.allocUnsafe(4 + json.length)
  out.writeUInt32BE(json.length, 0)
  json.copy(out, 4)
  return out
}

/**
 * Streaming decoder. Feed raw socket chunks via `push(chunk)`; it calls
 * `onMessage` once per complete frame parsed. On protocol violation the
 * provided `onError` runs and further input is rejected.
 */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0)
  private broken = false

  constructor(
    private readonly onMessage: (msg: SessionMessage) => void,
    private readonly onError: (err: Error) => void
  ) {}

  push(chunk: Buffer): void {
    if (this.broken) return
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0)
      if (len > MAX_FRAME_BYTES) {
        this.broken = true
        this.onError(new Error(`frame length ${len} exceeds max ${MAX_FRAME_BYTES}`))
        return
      }
      if (this.buf.length < 4 + len) return
      const payload = this.buf.subarray(4, 4 + len)
      this.buf = this.buf.subarray(4 + len)
      let msg: SessionMessage
      try {
        msg = JSON.parse(payload.toString('utf8')) as SessionMessage
      } catch (err) {
        this.broken = true
        this.onError(err as Error)
        return
      }
      try {
        this.onMessage(msg)
      } catch (err) {
        // Handler threw — surface and keep parsing.
        this.onError(err as Error)
      }
    }
  }
}

/** Send one message over a socket. Returns false if the socket is closed. */
export function sendMessage(sock: Socket | null, msg: SessionMessage): boolean {
  if (!sock || sock.destroyed) return false
  try {
    sock.write(encodeFrame(msg))
    return true
  } catch {
    return false
  }
}
