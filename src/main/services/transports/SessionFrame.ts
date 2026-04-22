/**
 * Framing helpers for the CM-to-CM session transport.
 *
 * Wire format: 4-byte big-endian unsigned length prefix + body.
 * The body's first byte is a codec marker:
 *   0x4A 'J' — JSON UTF-8 (default; legacy `{`/`[` first byte is also
 *               accepted for backward compat with v4 peers that don't
 *               emit a marker)
 *   0x4D 'M' — MessagePack (§E.32, opt-in via Hello/Welcome `'msgpack'`
 *               capability; smaller + faster on hot ops + bulk frames)
 * This is used by both `EditorSyncRelayService` (host side, accepts peers)
 * and `PeerClient` (joiner side, dials host).
 *
 * Max payload: 2 MiB (late-join baseline chunks are split below this).
 */
import { encode as msgpackEncode, decode as msgpackDecode } from '@msgpack/msgpack'

import { Socket } from 'net'

export const MAX_FRAME_BYTES = 2 * 1024 * 1024

/**
 * Wire protocol version. Bumped whenever `HelloMsg` / `WelcomeMsg` shape
 * changes in a way that older peers can't interpret correctly.
 *
 * History:
 *   1 — initial (no capability negotiation; `TRACKED_FIELDS` + touched-pid
 *        snapshot only; no mod inventory; brush strokes only).
 *   4 — Tier 4 + Tier 5: reflective fields, full scenetree snapshot, mod-
 *        inventory handshake, terrain/forest baseline, protocol-version
 *        reject path, capability advertisement via `tier4Capabilities` on
 *        Hello and `tier4Required` / `tier4Optional` on Welcome.
 *
 * A peer running protocol < host's minimum is rejected with
 * `{type:'error', code:'BAD_PROTOCOL', ...}` (see EditorSyncRelayService).
 */
export const WIRE_PROTOCOL_VERSION = 4

/** Tier 4 capability identifiers that can appear in Hello/Welcome. */
export type Tier4Capability =
  | 'reflectiveFields'
  | 'fullSnapshot'
  | 'modInventory'
  | 'terrainForest'
  | 'msgpack'

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
  | MissingModsRequestMsg
  | ModOfferMsg
  | ModsInstalledMsg
  | ModRequestMsg
  | ModChunkMsg
  | ModEndMsg

export interface HelloMsg {
  type: 'hello'
  /**
   * Wire protocol version the joiner speaks. Host compares against its own
   * `WIRE_PROTOCOL_VERSION` and rejects if the joiner is too old to handle
   * features the host has enabled. Back-compat: hosts accept `protocol: 1`
   * as long as they have zero Tier 4 capabilities required.
   */
  protocol: 1 | 4
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
  /**
   * Tier 4 capabilities this joiner's CM supports (see §A in
   * Docs/WORLD-EDITOR-SYNC.md). Absent or empty = legacy Tier 3 peer.
   * Host compares against its `tier4Required` list and rejects on mismatch.
   */
  tier4Capabilities?: Tier4Capability[]
  /** CM build identifier — diagnostic only, shown in logs and reject modal. */
  cmVersion?: string
}

export interface WelcomeMsg {
  type: 'welcome'
  authorId: string            // the host's own authorId
  yourAuthorId: string        // assigned to the joiner (echoes hello.authorId)
  peers: Array<{ authorId: string; displayName?: string }>
  lastSeq: number
  levelName?: string | null
  /** Host's wire protocol version. Joiner uses this for diagnostics. */
  protocol?: typeof WIRE_PROTOCOL_VERSION
  /**
   * Tier 4 capabilities the host has enabled. Joiner MUST support every
   * entry here (i.e. `tier4Required ⊆ hello.tier4Capabilities`) or the
   * host will have already sent a BAD_PROTOCOL error. Listed in the
   * Welcome for logging / UI transparency.
   */
  tier4Required?: Tier4Capability[]
  /**
   * Tier 4 capabilities the host has enabled that the joiner may opt out of
   * (host still provides the Tier 3 fallback for those channels). Purely
   * informational for the joiner UI.
   */
  tier4Optional?: Tier4Capability[]
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
  /**
   * Tier 4 Phase 3 coop mod sharing (§3). When the host has the
   * `modInventory` capability enabled, this is the full `ModManifest` of
   * mods that must be present on the joiner before the level loads. Absent
   * for Tier 3 peers and hosts with modInventory disabled. The HTTP share
   * port + auth token for mod downloads is reused from `project` (same
   * routes — `/session/<token>/mod/<id>.zip` — see relay service).
   */
  mods?: WelcomeModManifest
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
  /**
   * Opaque bearer token the joiner must present (as `?token=…` query
   * parameter) when GETting /project.zip. Minted per-session by the host
   * relay so third parties on the same LAN / Tailscale network can't snarf
   * the zip without having been welcomed into the session.
   */
  authToken: string
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

/**
 * Tier 4 Phase 3 coop mod sharing (§3). The ModManifest surface carried in
 * `WelcomeMsg.mods`. Kept in sync with `ModInventoryService` — any field
 * added to `ModManifestEntry` there must also appear here, since this
 * interface is what actually crosses the wire.
 */
export interface WelcomeModManifestEntry {
  id: string
  fileName: string
  sha256: string
  sizeBytes: number
  modType: string
  title: string | null
  version: string | null
  multiplayerScope: 'client' | 'both' | null
  resourceId: number | null
  declaredBy: 'host-local' | 'cm-project'
}

export interface WelcomeModManifest {
  beamngBuild: string
  /** Mod filenames the level's info.json references (ordering hint). */
  levelDependencies: string[]
  entries: WelcomeModManifestEntry[]
  /**
   * HTTP endpoint for downloading mods. Reuses the project-share server
   * port + token from `WelcomeProjectInfo` when that's present, but mod
   * sharing can also be enabled without a project, so the relay advertises
   * the coordinates here explicitly.
   */
  httpPort: number
  authToken: string
}

/**
 * Joiner → host ask for specific mods it's missing after running the diff.
 * Host responds with one `ModOfferMsg` per id; actual bytes flow over HTTP.
 */
export interface MissingModsRequestMsg {
  type: 'missingModsRequest'
  /** Joiner's authorId (for routing replies). */
  authorId: string
  /** Manifest ids the joiner needs. Subset of `welcome.mods.entries[*].id`. */
  ids: string[]
}

/**
 * Host → joiner confirmation that a given manifest id is available on the
 * share HTTP route. Carries the full download URL so the joiner can fetch
 * without re-deriving the route. Sent in response to `MissingModsRequest`;
 * also emitted spontaneously when a new mod is added mid-session.
 */
export interface ModOfferMsg {
  type: 'modOffer'
  id: string
  /** Absolute URL the joiner GETs to download the zip. */
  url: string
  /** Matches `WelcomeModManifestEntry.sha256` — joiner verifies post-download. */
  sha256: string
  sizeBytes: number
  fileName: string
}

/**
 * Joiner → host (broadcast by relay) signalling that the joiner has
 * completed installing + staging every mod it was missing. Host uses this
 * as the signal to open the snapshot gate for that peer. Payload lists
 * every id the joiner now has (exact-match + freshly-installed) so the
 * host can verify coverage before opening the gate.
 */
export interface ModsInstalledMsg {
  type: 'modsInstalled'
  authorId: string
  /** Ids the joiner now has locally (exact sha match). */
  presentIds: string[]
  /** Ids it had to disable locally for the session (not in manifest). */
  disabledIds: string[]
}

/* ── §E.33 TCP fallback for mod streaming ──────────────────────────────
 *
 * The default mod-share path uses a separate HTTP server on `port + 1`.
 * Some firewalls allow the negotiated session port through but block
 * adjacent ports. When the joiner can't reach the HTTP route, it can
 * ask the host to stream mod bytes inline over the existing session
 * TCP socket via `ModRequestMsg` → `ModChunkMsg × N` → `ModEndMsg`.
 * Slower (frames are JSON/MsgPack-armored, base64) but works whenever
 * the session itself works — zero infra requirement.
 */

/** Joiner → host: please stream mod bytes for `id` over TCP. */
export interface ModRequestMsg {
  type: 'modRequest'
  authorId: string
  /** Manifest id requested. Must match a `welcome.mods.entries[*].id`. */
  id: string
}

/** Host → joiner: one slice of a TCP-fallback mod transfer. */
export interface ModChunkMsg {
  type: 'modChunk'
  id: string
  /** Zero-based slice index. */
  index: number
  /** Total slice count, repeated for resilience to reordered streams. */
  total: number
  /** Base64-encoded raw bytes. */
  payload: string
}

/** Host → joiner: TCP-fallback transfer finished (success or error). */
export interface ModEndMsg {
  type: 'modEnd'
  id: string
  /** True on clean transfer; false when the host gave up partway. */
  ok: boolean
  /** Error string when ok=false (e.g. "mod zip missing on host"). */
  error?: string
  /** Sha256 the joiner should verify against (mirrors `ModOfferMsg.sha256`). */
  sha256: string
  sizeBytes: number
  fileName: string
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
  /**
   * Slice of the JSON payload. When `compressed` is unset/false, this is
   * the raw UTF-8 string the host Lua produced. When `compressed:'deflate-raw'`,
   * the payload is a base64-encoded raw-deflate blob — the joiner CM
   * inflates + base64-decodes back to the same UTF-8 string before
   * forwarding to local Lua. Lua never sees compressed bytes.
   */
  payload: string
  /** §E.34 — compression algorithm applied to `payload`. Omit for raw UTF-8. */
  compressed?: 'deflate-raw'
  /** §E.34 — uncompressed payload length, advisory (UI progress / sanity). */
  uncompressedLen?: number
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

/** Wire codec for one frame body. */
export type FrameCodec = 'json' | 'msgpack'

/** Per-socket codec selection for `sendMessage`. */
const codecBySocket = new WeakMap<Socket, FrameCodec>()

/**
 * §E.32 — set the encoding codec for outbound frames on this socket.
 * Default is `'json'`. Both peers MUST advertise `'msgpack'` in their
 * Hello/Welcome capability lists before either side switches; otherwise
 * the receiver will see an unrecognised codec marker and drop.
 */
export function setSocketCodec(sock: Socket, codec: FrameCodec): void {
  codecBySocket.set(sock, codec)
}

export function getSocketCodec(sock: Socket): FrameCodec {
  return codecBySocket.get(sock) ?? 'json'
}

/** Encode one message to a length-prefixed frame buffer. */
export function encodeFrame(msg: SessionMessage, codec: FrameCodec = 'json'): Buffer {
  let body: Buffer
  if (codec === 'msgpack') {
    // 0x4D 'M' marker + MessagePack body. msgpackEncode returns a
    // Uint8Array — wrap (no copy) into a Node Buffer for concat.
    const mp = msgpackEncode(msg)
    const mpBuf = Buffer.from(mp.buffer, mp.byteOffset, mp.byteLength)
    body = Buffer.concat([Buffer.from([0x4d]), mpBuf])
  } else {
    // 0x4A 'J' marker + JSON UTF-8. v4 peers that don't write a marker
    // are still handled by the decoder via `{`/`[` first-byte detection.
    const json = Buffer.from(JSON.stringify(msg), 'utf8')
    body = Buffer.concat([Buffer.from([0x4a]), json])
  }
  if (body.length > MAX_FRAME_BYTES) {
    throw new Error(`SessionTransport: frame too large (${body.length} > ${MAX_FRAME_BYTES})`)
  }
  const out = Buffer.allocUnsafe(4 + body.length)
  out.writeUInt32BE(body.length, 0)
  body.copy(out, 4)
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
        // §E.32 — first byte is the codec marker; accept legacy
        // unmarked JSON whose first byte is `{` (0x7B) or `[` (0x5B).
        const marker = payload[0]
        if (marker === 0x4d) {
          // MessagePack body — slice off the 1-byte marker.
          const view = payload.subarray(1)
          // msgpackDecode wants a Uint8Array; Buffer is one. Cast the
          // result; we trust the sender's wire shape (same as JSON.parse).
          msg = msgpackDecode(view) as SessionMessage
        } else if (marker === 0x4a) {
          msg = JSON.parse(payload.subarray(1).toString('utf8')) as SessionMessage
        } else if (marker === 0x7b /* { */ || marker === 0x5b /* [ */) {
          // Legacy v4 peer: whole body is JSON, no marker byte.
          msg = JSON.parse(payload.toString('utf8')) as SessionMessage
        } else {
          this.broken = true
          this.onError(new Error(`unknown frame codec marker 0x${marker.toString(16)}`))
          return
        }
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
    sock.write(encodeFrame(msg, getSocketCodec(sock)))
    return true
  } catch {
    return false
  }
}
