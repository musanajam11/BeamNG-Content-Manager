/**
 * §E.6 — Converters between the legacy CM "project zip" and the
 * `.beamcmworld` container.
 *
 * The legacy project zip is just a deflate-zip of a single
 * `<userDir>/levels/_beamcm_projects/<folder>/` directory and carries
 * no runtime state — no snapshot, no terrain, no forest, no mods.
 * `.beamcmworld` is the superset format and adds all of those.
 *
 * The two converters here are intentionally narrow:
 *
 * - `convertProjectZipToWorld` — wrap an existing project zip in a
 *   `.beamcmworld` shell. The original zip is stashed verbatim under
 *   the optional `project.zip` entry (`embeddedProject` section flag)
 *   so the reverse conversion is lossless. No runtime state is
 *   synthesised.
 *
 * - `convertWorldToProjectZip` — extract the embedded `project.zip`
 *   from a `.beamcmworld`. Errors out cleanly if the world wasn't
 *   produced by the wrapper above (i.e. doesn't carry an embedded
 *   project), since "session-saved" worlds have no level folder to
 *   peel back to.
 *
 * These live in their own file so the save/load pipeline stays small
 * and the converters can grow features (e.g. embedding a mods folder
 * snapshot) without touching the hot-path code.
 */

import { createReadStream, createWriteStream, mkdirSync, statSync } from 'node:fs'
import { dirname, basename } from 'node:path'
import archiver from 'archiver'
import { open as yauzlOpen, type Entry } from 'yauzl'
import { randomUUID } from 'node:crypto'

import {
  BEAMCMWORLD_FORMAT_VERSION, BEAMCMWORLD_PATHS,
  type WorldManifest,
} from './WorldContainerLayout'
import { inspectWorldZip } from './WorldSaveReader'

export interface ConvertProjectToWorldOpts {
  /** Existing CM project zip on disk. */
  sourceProjectZip: string
  /** Destination `.beamcmworld` path. */
  destPath: string
  /** Stock BeamNG level identifier the project was based on. */
  levelName: string
  /** Optional title; defaults to the project zip's basename without extension. */
  title?: string
  description?: string
  /** Author identity to record as the sole contributor. */
  authorId: string
  authorDisplayName: string
  /** Optional BeamNG game build label. */
  beamngBuild?: string
}

export interface ConvertProjectToWorldResult {
  path: string
  bytes: number
  manifest: WorldManifest
}

export interface ConvertWorldToProjectOpts {
  sourceWorld: string
  /** Destination project-zip path (`.zip`). */
  destProjectZip: string
}

export interface ConvertWorldToProjectResult {
  path: string
  bytes: number
}

/* ── Project → World ───────────────────────────────────────────────── */

/**
 * Wrap an existing CM project zip in a `.beamcmworld` shell. The
 * project zip's bytes are stored unchanged at `project.zip` (stored,
 * not re-deflated, since it's already compressed) so that
 * `convertWorldToProjectZip` is a perfect round-trip.
 */
export async function convertProjectZipToWorld(
  opts: ConvertProjectToWorldOpts,
): Promise<ConvertProjectToWorldResult> {
  // Validate input early so we don't half-write the destination.
  let projectZipBytes = 0
  try {
    projectZipBytes = statSync(opts.sourceProjectZip).size
  } catch (e) {
    throw new Error(`source project zip not readable: ${(e as Error).message}`)
  }

  const title = opts.title ?? basename(opts.sourceProjectZip).replace(/\.zip$/i, '')
  const now = Date.now()
  const manifest: WorldManifest = {
    formatVersion: BEAMCMWORLD_FORMAT_VERSION,
    levelName: opts.levelName,
    beamngBuild: opts.beamngBuild,
    worldId: randomUUID(),
    title,
    description: opts.description,
    contributors: [{ authorId: opts.authorId, displayName: opts.authorDisplayName }],
    createdAt: now,
    modifiedAt: now,
    sections: {
      snapshot: false,
      terrain: false,
      forest: false,
      mods: false,
      oplog: false,
      preview: false,
      embeddedProject: true,
    },
  }

  mkdirSync(dirname(opts.destPath), { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(opts.destPath)
    const ar = archiver('zip', { zlib: { level: 6 } })
    let settled = false
    const fail = (e: unknown): void => {
      if (settled) return
      settled = true
      reject(e instanceof Error ? e : new Error(String(e)))
    }
    out.on('close', () => { if (!settled) { settled = true; resolve() } })
    out.on('error', fail)
    ar.on('error', fail)
    ar.pipe(out)
    ar.append(JSON.stringify(manifest, null, 2), { name: BEAMCMWORLD_PATHS.manifest })
    // store:true — the source zip is already compressed; double-deflating wastes CPU.
    // Stream from disk so we don't pull a multi-GB project zip into RAM.
    ar.append(createReadStream(opts.sourceProjectZip), {
      name: BEAMCMWORLD_PATHS.embeddedProject,
      store: true,
    })
    ar.finalize().catch(fail)
  })

  let bytes = 0
  try { bytes = statSync(opts.destPath).size } catch { /* leave 0 */ }
  void projectZipBytes // surfaced via manifest.sections.embeddedProject
  return { path: opts.destPath, bytes, manifest }
}

/* ── World → Project ───────────────────────────────────────────────── */

/**
 * Extract the embedded `project.zip` from a `.beamcmworld` and write
 * it as a standalone project zip. Errors with a clear message if the
 * world doesn't have an embedded project (i.e. it was produced by a
 * live session, not by `convertProjectZipToWorld`).
 */
export async function convertWorldToProjectZip(
  opts: ConvertWorldToProjectOpts,
): Promise<ConvertWorldToProjectResult> {
  // Cheap manifest check first — fail fast if the world is not the
  // wrapper kind.
  const inspect = await inspectWorldZip(opts.sourceWorld)
  if (!inspect.manifest.sections.embeddedProject) {
    throw new Error(
      `${opts.sourceWorld}: no embedded project zip — this world was produced by a live ` +
      `editing session, not by Project→World conversion. Use the "Save World" UI instead ` +
      `to share its runtime state.`,
    )
  }

  mkdirSync(dirname(opts.destProjectZip), { recursive: true })
  await new Promise<void>((resolve, reject) => {
    yauzlOpen(opts.sourceWorld, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) { reject(err ?? new Error('yauzl open returned no zipfile')); return }
      let extracted = false
      zip.readEntry()
      zip.on('entry', (entry: Entry) => {
        if (entry.fileName !== BEAMCMWORLD_PATHS.embeddedProject) {
          zip.readEntry()
          return
        }
        zip.openReadStream(entry, (sErr, stream) => {
          if (sErr || !stream) { reject(sErr ?? new Error('openReadStream null')); return }
          const out = createWriteStream(opts.destProjectZip)
          out.on('error', reject)
          out.on('close', () => { extracted = true; zip.readEntry() })
          stream.on('error', reject)
          stream.pipe(out)
        })
      })
      zip.on('error', reject)
      zip.on('end', () => {
        if (!extracted) {
          reject(new Error(
            `${opts.sourceWorld}: manifest claimed embeddedProject=true but ${BEAMCMWORLD_PATHS.embeddedProject} entry was missing`,
          ))
          return
        }
        resolve()
      })
    })
  })

  let bytes = 0
  try { bytes = statSync(opts.destProjectZip).size } catch { /* leave 0 */ }
  return { path: opts.destProjectZip, bytes }
}
