/**
 * §E.3 — `.beamcmworld` zip writer.
 *
 * Pure I/O helper. The orchestrator (`WorldSaveService`) gathers all
 * the pieces (snapshot bytes, mod manifest, level identity, …) into a
 * `WorldSaveInputs` plain object and hands them here; this file only
 * does the actual disk work.
 *
 * Splitting it out keeps the orchestrator readable and lets a future
 * unit test write a synthetic zip without spinning a relay or BeamNG.
 *
 * Compression: `zlib.level = 6` to match the rest of the codebase
 * (CoopSessionStagingService, EditorSyncRelayService).
 *
 * Mod zips are appended with `store=true` (no recompress) because they
 * are already deflate-compressed; double-compressing only burns CPU.
 */

import { createWriteStream, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import archiver from 'archiver'

import {
  BEAMCMWORLD_FORMAT_VERSION, BEAMCMWORLD_PATHS,
  type WorldManifest, type WorldModsManifest,
} from './WorldContainerLayout'
import type { SaveProgressCallback } from './WorldSaveService'

/** Inputs the orchestrator hands to the writer. */
export interface WorldSaveInputs {
  /** Absolute path of the destination `.beamcmworld` zip. */
  destPath: string
  /** Stable per-world UUID. Newly minted on first save; preserved on re-save. */
  worldId: string
  /**
   * Original creation timestamp from the prior manifest, when re-saving
   * over an existing `.beamcmworld`. Omitted on first save — the writer
   * stamps `Date.now()` for both `createdAt` and `modifiedAt`.
   */
  createdAt?: number
  /** Stock BeamNG level identifier (e.g. "italy", "smallgrid"). */
  levelName: string
  /** Free-form title shown in CM. */
  title: string
  description?: string
  beamngBuild?: string
  /** Authors who edited this world. The local user is always included. */
  contributors: WorldManifest['contributors']
  /**
   * Snapshot payload as raw bytes (the JSON string the host Lua produced
   * for joiners). Null when no snapshot has been built — manifest will
   * carry `sections.snapshot=false` and the section is omitted.
   */
  snapshotBytes: Buffer | null
  /**
   * Mod manifest + per-mod zip resolver. `resolveZip(modId)` should
   * return the absolute path of the on-disk zip; null skips that mod
   * (e.g. server-only mods we never copied locally).
   */
  modsManifest: WorldModsManifest | null
  resolveModZip?: (modId: string) => string | null | Promise<string | null>
  /**
   * Optional op log payload (already serialised; format determined by
   * the caller — currently raw JSONL bytes, msgpack later per the
   * "MessagePack wire format" bookmark).
   */
  oplogBytes?: Buffer | null
  /** Optional 512×512 PNG preview as raw bytes. */
  previewPng?: Buffer | null
  /** Optional progress callback (writer reports per phase). */
  onProgress?: SaveProgressCallback
}

/** Result returned to the orchestrator. */
export interface WorldSaveWriteResult {
  path: string
  bytes: number
  manifest: WorldManifest
}

/**
 * Stream-build the zip. Resolves with the on-disk size + the manifest
 * we wrote so the orchestrator can echo it back to the renderer
 * without re-reading the file.
 */
export async function writeWorldSave(input: WorldSaveInputs): Promise<WorldSaveWriteResult> {
  // Make sure the destination directory exists; archiver will not.
  mkdirSync(dirname(input.destPath), { recursive: true })

  const now = Date.now()
  const manifest: WorldManifest = {
    formatVersion: BEAMCMWORLD_FORMAT_VERSION,
    levelName: input.levelName,
    beamngBuild: input.beamngBuild,
    worldId: input.worldId,
    title: input.title,
    description: input.description,
    contributors: input.contributors,
    createdAt: input.createdAt ?? now,
    modifiedAt: now,
    preview: input.previewPng
      ? { width: 0, height: 0, bytes: input.previewPng.length }
      : undefined,
    sections: {
      snapshot: input.snapshotBytes !== null,
      // Terrain / forest plumbing (#28 follow-up): the Lua-side collect
      // helpers are gated behind `cmTier4Flags.terrainForest` and not
      // yet wired through to CM. Mark absent so v1 readers don't expect
      // them. The TerrainSnapshotService / ForestSnapshotService types
      // are ready; only the snapshot-trigger plumbing is missing.
      terrain: false,
      forest: false,
      mods: input.modsManifest !== null && (input.modsManifest.mods.length > 0),
      oplog: !!input.oplogBytes && input.oplogBytes.length > 0,
      preview: !!input.previewPng && input.previewPng.length > 0,
    },
  }

  const out = createWriteStream(input.destPath)
  const archive = archiver('zip', { zlib: { level: 6 } })

  // Promise-ify the write/close lifecycle. `out.close` resolves when
  // the OS handle is fully flushed — important on Windows because we
  // immediately statSync below.
  const done = new Promise<void>((resolve, reject) => {
    out.on('error', reject)
    out.on('close', () => resolve())
    archive.on('error', reject)
    // 'warning' events with code ENOENT just mean the directory was
    // empty — non-fatal for our use-case (no terrain/forest yet).
    archive.on('warning', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') reject(err)
    })
  })

  archive.pipe(out)

  // 1. manifest first so a streaming reader can decide whether to
  //    keep reading the rest of the entries (E.5: section-presence
  //    flags drive selective unpacking).
  archive.append(JSON.stringify(manifest, null, 2), { name: BEAMCMWORLD_PATHS.manifest })

  // 2. snapshot.snap — the joiner-format snapshot blob, byte-identical.
  if (input.snapshotBytes) {
    input.onProgress?.({ phase: 'snapshot', pct: 0 })
    archive.append(input.snapshotBytes, { name: BEAMCMWORLD_PATHS.snapshot })
    input.onProgress?.({ phase: 'snapshot', pct: 100 })
  }

  // 3. mods.manifest.json + the actual mod zips (store, no recompress).
  if (input.modsManifest && input.modsManifest.mods.length > 0) {
    archive.append(JSON.stringify(input.modsManifest, null, 2), {
      name: BEAMCMWORLD_PATHS.modsManifest,
    })
    let i = 0
    const total = input.modsManifest.mods.length
    for (const mod of input.modsManifest.mods) {
      i++
      input.onProgress?.({ phase: 'mods', pct: Math.round((i / total) * 100), modId: mod.modId })
      const path = await Promise.resolve(input.resolveModZip?.(mod.modId) ?? null)
      if (!path) continue
      try {
        // Read into a buffer instead of streaming so a missing/locked
        // file fails loudly here rather than during finalisation,
        // where archiver swallows errors as warnings.
        const zipBytes = await readFile(path)
        archive.append(zipBytes, { name: BEAMCMWORLD_PATHS.mods(mod.modId), store: true })
      } catch (err) {
        // Skip individual mod failures — mark the manifest entry so the
        // load flow can re-fetch from BeamNG repo. Surface a warning
        // back to the caller via the progress callback's no-op path.
        console.warn(
          `[WorldSaveWriter] mod ${mod.modId} unavailable at ${path}: ${(err as Error).message}`,
        )
      }
    }
  }

  // 4. oplog.msgpack (optional). Currently JSONL; bookmark to swap to
  //    MessagePack when the wire-format bookmark is implemented.
  if (input.oplogBytes && input.oplogBytes.length > 0) {
    input.onProgress?.({ phase: 'oplog', pct: 0 })
    archive.append(input.oplogBytes, { name: BEAMCMWORLD_PATHS.oplog })
    input.onProgress?.({ phase: 'oplog', pct: 100 })
  }

  // 5. preview.png (optional).
  if (input.previewPng && input.previewPng.length > 0) {
    archive.append(input.previewPng, { name: BEAMCMWORLD_PATHS.preview, store: true })
  }

  input.onProgress?.({ phase: 'finalise', pct: 0 })
  await archive.finalize()
  await done
  input.onProgress?.({ phase: 'finalise', pct: 100 })

  const bytes = statSync(input.destPath).size
  return { path: input.destPath, bytes, manifest }
}
