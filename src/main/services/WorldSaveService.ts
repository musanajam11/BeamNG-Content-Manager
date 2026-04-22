/**
 * §E.7 — WorldSaveService
 *
 * Owner of `.beamcmworld` save/load/inspect. The actual zip writing
 * lives in `WorldSaveWriter.ts`; this orchestrator gathers all the
 * pieces (snapshot bytes from the relay, mod manifest, level identity,
 * contributors) and hands them off.
 *
 * Design rules:
 * - No new wire types. Save/load is pure CM-side; the host pauses live
 *   ops via the existing snapshot-gate machinery and reuses the same
 *   joiner-format snapshot blob the relay already builds.
 * - The service is dependency-injected with the controller + game
 *   launcher so unit tests can exercise the orchestration logic
 *   without spinning a real BeamNG.
 */

import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { join as joinPath } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile as readFileAsync } from 'node:fs/promises'

import type { GameLauncherService } from './GameLauncherService'
import type { EditorSyncSessionController } from './EditorSyncSessionController'
import type { WorldManifest, WorldInspectResult, WorldModsManifest } from './WorldContainerLayout'
import type { WelcomeModManifest } from './transports/SessionFrame'
import type { OpMsg } from './transports/SessionFrame'
import { writeWorldSave } from './WorldSaveWriter'
import { inspectWorldZip, readWorldZip } from './WorldSaveReader'
import { parseWorldOpLog } from './WorldOpLogReader'

/** Options accepted by `saveCurrentWorld`. */
export interface SaveWorldOpts {
  /** Absolute path of the destination `.beamcmworld` file. */
  destPath: string
  /** Human-readable title (defaults to filename stem if absent). */
  title?: string
  description?: string
  /**
   * Persist a preview screenshot alongside the manifest. Two ways to
   * supply it (in priority order):
   *   1. `previewPngPath` — absolute path to an existing PNG (e.g. one
   *      the user picked, or a screenshot the renderer captured into
   *      a temp file). Read once and embedded.
   *   2. `previewPngBytes` — raw PNG bytes already in memory (e.g.
   *      from a `<canvas>.toBlob()` round-trip in the renderer).
   * `includePreview` is kept for back-compat but is now a no-op when
   * neither field is set — a future revision can re-add automatic
   * screenshot capture once a Lua RPC for it exists.
   */
  includePreview?: boolean
  previewPngPath?: string
  previewPngBytes?: Buffer
  /**
   * Include the relay's recent op log (E.3 step 5). Only meaningful
   * when a host session is active; ignored otherwise. Default false
   * because the log is large and most consumers don't need it.
   */
  includeOpLog?: boolean
  /**
   * Surface a size estimate before writing? When true, the service
   * emits a `'sizeEstimate'` progress callback first; the caller can
   * cancel by returning false from the callback.
   */
  estimateFirst?: boolean
  /**
   * §E.3 — if no built snapshot is cached on the relay yet (e.g. solo
   * host that just opened the editor and nobody joined), ask Lua to
   * build one synchronously before writing the zip. Default true.
   * Set false to allow saving a `.beamcmworld` with no `snapshot.snap`
   * payload (manifest-only / mods-only export).
   */
  forceBuildSnapshot?: boolean
  /** Timeout for the forced snapshot build in ms (default 15000). */
  forceBuildSnapshotTimeoutMs?: number
}

export interface LoadWorldOpts {
  /** Absolute path of the `.beamcmworld` to load. */
  sourcePath: string
  /**
   * Where unpacked mods should be staged. Mirrors the Phase 3 staging
   * path layout (`mods/multiplayer/world-<worldId>/`) but tagged
   * `worldScope` so `CoopSessionStagingService.cleanupSession` won't
   * touch them on disconnect — this is persistent state.
   */
  stagingRoot: string
}

/**
 * Stable result returned by `saveCurrentWorld`. Includes the manifest
 * for callers that want to preview "what we just wrote" without
 * re-reading the zip.
 */
export interface SaveWorldResult {
  path: string
  bytes: number
  manifest: WorldManifest
}

/** The renderer can subscribe to incremental progress via this callback. */
export type SaveProgressEvent =
  | { phase: 'sizeEstimate'; estimatedBytes: number }
  | { phase: 'snapshotBuild' }
  | { phase: 'snapshot'; pct: number }
  | { phase: 'terrain'; pct: number }
  | { phase: 'forest'; pct: number }
  | { phase: 'mods'; pct: number; modId?: string }
  | { phase: 'oplog'; pct: number }
  | { phase: 'finalise'; pct: number }

export type SaveProgressCallback = (e: SaveProgressEvent) => boolean | void

export class WorldSaveService {
  constructor(
    private readonly _gameLauncher: GameLauncherService,
    private readonly session: EditorSyncSessionController,
    /**
     * Resolves a `modId` to the absolute path of its zip on disk. The
     * orchestrator does not own the mod inventory; the IPC layer wires
     * this to a callback that walks `gamePaths.userDir/mods/`.
     * Returns null when the mod is not present locally (server-only,
     * etc.) — the writer will skip that entry.
     */
    private readonly resolveModZip: ((modId: string) => string | null | Promise<string | null>) | null = null,
  ) {
    void this._gameLauncher
  }

  /**
   * Save the currently-open world to a `.beamcmworld` zip. Pulls the
   * most recently built joiner snapshot, the active mod manifest and
   * the contributor list from the controller, and hands everything to
   * the writer. When `forceBuildSnapshot` is true (default) and no
   * cached snapshot exists, asks Lua to build one first — lets a solo
   * host save without ever having had a joiner.
   */
  async saveCurrentWorld(
    opts: SaveWorldOpts,
    onProgress?: SaveProgressCallback,
  ): Promise<SaveWorldResult> {
    let snap = this.session.getCurrentSnapshotBytes()

    // §E.3 — solo host with no cached snapshot? Trigger a build now.
    // Tracked separately from `progress.snapshot` so the UI can show a
    // spinner for the round-trip without conflating it with the zip
    // write phase. `forceBuildSnapshot === false` opts out (used by
    // "export mods + manifest only" callers).
    const wantBuild = opts.forceBuildSnapshot !== false
    if (!snap && wantBuild) {
      onProgress?.({ phase: 'snapshotBuild' })
      try {
        const built = await this.session.forceSnapshotBuild(opts.forceBuildSnapshotTimeoutMs)
        if (built) {
          snap = {
            bytes: built.bytes,
            levelName: built.levelName,
            baseSeq: built.baseSeq,
            createdTs: built.createdTs,
          }
        }
      } catch (e) {
        // A failed build shouldn't block a save — fall through with no
        // snapshot. Most often this means the game isn't running, in
        // which case the resulting `.beamcmworld` is just a mod bundle.
        console.warn(
          `[WorldSaveService] forceSnapshotBuild failed; saving without snapshot: ${(e as Error).message}`,
        )
      }
    }

    const levelName = snap?.levelName ?? this.session.getLevelName()
    if (!levelName) {
      throw new Error(
        'WorldSaveService.saveCurrentWorld: no active level — open a world in the editor first',
      )
    }

    // §E.5: worldId is stable across re-saves of the same world. If
    // the destination already exists, peel its manifest and reuse the
    // worldId so contributors / repo tracking stays consistent. A
    // fresh save (or an unreadable existing file) gets a new UUID.
    let worldId: string = randomUUID()
    let createdAt: number | undefined
    let priorContributors: WorldManifest['contributors'] = []
    if (existsSync(opts.destPath)) {
      try {
        const prior = await inspectWorldZip(opts.destPath)
        worldId = prior.manifest.worldId
        createdAt = prior.manifest.createdAt
        priorContributors = prior.manifest.contributors ?? []
      } catch (e) {
        // Existing file isn't a readable .beamcmworld — overwrite it
        // with a fresh worldId. Surface only as a warning since the
        // user explicitly chose this path.
        console.warn(
          `[WorldSaveService] existing destination not a valid .beamcmworld; ` +
          `overwriting with fresh worldId: ${(e as Error).message}`,
        )
      }
    }
    const title = opts.title ?? basename(opts.destPath).replace(/\.beamcmworld$/i, '')

    const contributors = this.mergeContributors(priorContributors, this.buildContributorList())
    const modsManifest = this.toWorldModsManifest(this.session.getActiveModManifest())
    const oplogBytes = opts.includeOpLog ? this.serialiseOpLog() : null

    onProgress?.({ phase: 'sizeEstimate', estimatedBytes: this.estimateSize(snap?.bytes ?? null, modsManifest) })

    const result = await writeWorldSave({
      destPath: opts.destPath,
      worldId,
      createdAt,
      levelName,
      title,
      description: opts.description,
      contributors,
      snapshotBytes: snap?.bytes ?? null,
      modsManifest,
      resolveModZip: (modId) => this.resolveModZip?.(modId) ?? null,
      // (resolveModZip may return a Promise — the writer awaits it)
      oplogBytes,
      previewPng: await this.resolvePreviewPng(opts),
      onProgress,
    })

    return { path: result.path, bytes: result.bytes, manifest: result.manifest }
  }

  /**
   * Load a `.beamcmworld` and prepare BeamNG to enter it. Walks the
   * zip, stages mod payloads under `stagingRoot/world-<worldId>/`,
   * caches the snapshot bytes for the joiner-format apply pipeline
   * and returns enough info for the caller (UI / launch flow) to
   * actually open the level. The mod-install / level-launch steps
   * remain the caller's responsibility — this service is pure
   * unpack-and-stage.
   */
  async loadWorld(opts: LoadWorldOpts): Promise<{
    levelName: string
    worldId: string
    stagedModsPath: string | null
    snapshotBytes: Buffer | null
    modsManifest: WorldModsManifest | null
    stagedMods: Array<{ modId: string; path: string }>
    /** Number of ops parsed from `oplog.msgpack` (0 when no log was present). */
    opLogCount: number
    /** True when the host was already in `hosting` state and the snapshot+ops
     *  were seeded into the relay so any joiner gets the saved world. */
    seededIntoRelay: boolean
  }> {
    let manifestRef: WorldManifest | null = null
    let snapshotBytes: Buffer | null = null
    let modsManifest: WorldModsManifest | null = null
    let parsedOps: OpMsg[] = []
    const stagedMods: Array<{ modId: string; path: string }> = []

    const result = await readWorldZip({
      sourcePath: opts.sourcePath,
      modsExtractDir: opts.stagingRoot,
      sinks: {
        onSnapshot: (b) => { snapshotBytes = b },
        onModsManifest: (m) => { modsManifest = m },
        onMod: (modId, path) => { stagedMods.push({ modId, path }) },
        onOpLog: (b) => {
          // Parse the JSONL bytes into typed envelopes. Bad lines are
          // skipped with a warning rather than failing the whole load.
          const parsed = parseWorldOpLog(b)
          parsedOps = parsed.ops
        },
        onPreview: () => { /* renderer reads preview straight from zip */ },
      },
    })
    manifestRef = result.manifest

    // §E.4 — auto-seed the relay if we're already hosting. This is the
    // common "host clicks Load" path: snapshot + ops become live for any
    // joiner without needing a fresh in-game build. If the user isn't
    // hosting yet, the caller can re-call `seedSavedWorld` later via the
    // controller once `host()` succeeds.
    let seededIntoRelay = false
    try {
      seededIntoRelay = this.session.seedSavedWorld({
        snapshotBytes,
        ops: parsedOps,
        levelName: manifestRef.levelName,
      })
    } catch (e) {
      console.warn(`[WorldSaveService] seedSavedWorld failed: ${(e as Error).message}`)
    }

    return {
      levelName: manifestRef.levelName,
      worldId: manifestRef.worldId,
      stagedModsPath: stagedMods.length > 0 ? opts.stagingRoot : null,
      snapshotBytes,
      modsManifest,
      stagedMods,
      opLogCount: parsedOps.length,
      seededIntoRelay,
    }
  }

  /**
   * Read just the manifest + entry directory of a container without
   * unpacking. Cheap enough to call from a file-picker preview.
   */
  async inspectWorld(path: string): Promise<WorldInspectResult> {
    return inspectWorldZip(path)
  }

  /* ── helpers ──────────────────────────────────────────────────────── */

  /** Build the manifest contributor list from the local user only.
   *  Multi-author trail is a Tier 6 follow-up; for now we record the
   *  saver as the sole contributor and the load flow can merge as
   *  future saves accumulate authors. */
  private buildContributorList(): WorldManifest['contributors'] {
    return [{
      authorId: this.session.getAuthorId(),
      displayName: this.session.getDisplayName(),
    }]
  }

  /** Merge the prior contributor list with the local one, deduping by
   *  `authorId`. Preserves prior order so the historical "first author"
   *  stays at the front of the list. */
  private mergeContributors(
    prior: WorldManifest['contributors'],
    local: WorldManifest['contributors'],
  ): WorldManifest['contributors'] {
    const seen = new Set<string>()
    const out: WorldManifest['contributors'] = []
    for (const c of [...prior, ...local]) {
      if (seen.has(c.authorId)) continue
      seen.add(c.authorId)
      out.push(c)
    }
    return out
  }

  /** Adapt the host's `WelcomeModManifest` to the on-disk
   *  `WorldModsManifest` shape. The two are intentionally separate so a
   *  future wire format change doesn't break old `.beamcmworld` files. */
  private toWorldModsManifest(src: WelcomeModManifest | null): WorldModsManifest | null {
    if (!src || src.entries.length === 0) return null
    return {
      mods: src.entries.map((e) => ({
        modId: e.id,
        name: e.title ?? e.fileName,
        filename: e.fileName,
        sizeBytes: e.sizeBytes,
        sha256: e.sha256,
      })),
    }
  }

  /** Serialise the relay's recent op log as JSONL for now (one op per
   *  line). The "MessagePack wire format" bookmark will swap this for
   *  msgpack when that lands; the file extension stays `.msgpack` per
   *  spec §E.2 to avoid a layout bump. */
  private serialiseOpLog(): Buffer | null {
    const ops = this.session.getRecentOps()
    if (ops.length === 0) return null
    const lines = ops.map((op) => JSON.stringify(op)).join('\n') + '\n'
    return Buffer.from(lines, 'utf8')
  }

  /** Cheap upper-bound size estimate so the renderer can warn
   *  before the user commits to a multi-GB write. */
  private estimateSize(snapshotBytes: Buffer | null, mods: WorldModsManifest | null): number {
    let total = 4 * 1024 // manifest + scaffolding
    if (snapshotBytes) total += snapshotBytes.length
    if (mods) for (const m of mods.mods) total += m.sizeBytes
    return total
  }

  /**
   * §E.3 step 6 — resolve the optional preview PNG. Priority:
   *   1. raw bytes (`previewPngBytes`)
   *   2. file path (`previewPngPath`) — read once, validated as PNG
   *   3. nothing — returns null
   * Invalid PNGs and read errors are swallowed with a warning so a
   * dud preview file never blocks a save.
   */
  private async resolvePreviewPng(opts: SaveWorldOpts): Promise<Buffer | null> {
    if (opts.previewPngBytes && opts.previewPngBytes.length > 0) {
      return this.validatePngHeader(opts.previewPngBytes) ? opts.previewPngBytes : null
    }
    if (!opts.previewPngPath) return null
    try {
      const bytes = await readFileAsync(opts.previewPngPath)
      if (!this.validatePngHeader(bytes)) {
        console.warn(`[WorldSaveService] preview file is not a PNG: ${opts.previewPngPath}`)
        return null
      }
      return bytes
    } catch (e) {
      console.warn(`[WorldSaveService] could not read preview PNG: ${(e as Error).message}`)
      return null
    }
  }

  /** PNG magic bytes per RFC 2083 §3.1: 89 50 4E 47 0D 0A 1A 0A. */
  private validatePngHeader(bytes: Buffer): boolean {
    if (bytes.length < 8) return false
    return (
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    )
  }
}

// `joinPath` only used internally; re-export to keep the import alive
// for downstream WorldSaveReader once #29 lands.
export { joinPath as _joinPathInternal }
