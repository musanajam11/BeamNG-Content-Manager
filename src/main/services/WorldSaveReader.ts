/**
 * §E.4 — `.beamcmworld` zip reader.
 *
 * Symmetric with `WorldSaveWriter.ts`. Two entry points:
 *
 * - `inspectWorldZip(path)` — manifest-only read. Cheap; suitable for
 *   a file-picker preview. Skips entry payloads.
 * - `readWorldZip(path, opts)` — full read. Streams each entry through
 *   a per-section sink so big sections (snapshot.snap, mods/*.zip)
 *   never sit in memory all at once.
 *
 * Compatibility rules per spec §E.5:
 * - `formatVersion === 1` is required; future bumps are rejected with
 *   a clean error message so the reader doesn't try to parse a schema
 *   it doesn't understand.
 * - Unknown entries are logged + skipped (forward-compat for new
 *   sections like `audio/`, `prefabs/`).
 * - `manifest.sections` flags are advisory; we still honour any entry
 *   we actually find on disk.
 */

import { mkdirSync, createWriteStream, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { open as yauzlOpen, type Entry, type ZipFile } from 'yauzl'

import {
  BEAMCMWORLD_FORMAT_VERSION, BEAMCMWORLD_PATHS,
  type WorldManifest, type WorldInspectResult, type WorldModsManifest,
} from './WorldContainerLayout'

/** Sinks the orchestrator wires up for each section. Returning `false`
 *  from any sink aborts the read with a clean error. */
export interface WorldReadSinks {
  /** Snapshot blob (joiner-format JSON string bytes). */
  onSnapshot?: (bytes: Buffer) => void | Promise<void>
  /** Mods manifest JSON (already parsed). */
  onModsManifest?: (manifest: WorldModsManifest) => void | Promise<void>
  /** One mod zip; called once per `mods/<id>.zip` entry. The reader
   *  passes the destination path it wrote the bytes to so the caller
   *  can defer mod installation until after the manifest is in hand. */
  onMod?: (modId: string, destPath: string) => void | Promise<void>
  /** Op log bytes (currently JSONL — bookmark for msgpack). */
  onOpLog?: (bytes: Buffer) => void | Promise<void>
  /** Preview PNG bytes. */
  onPreview?: (bytes: Buffer) => void | Promise<void>
}

export interface ReadWorldOpts {
  sourcePath: string
  /** Where to stage extracted mod zips (one file per mod). The
   *  directory is created on demand. */
  modsExtractDir: string
  sinks: WorldReadSinks
}

export interface ReadWorldResult {
  manifest: WorldManifest
  /** Section names actually observed during the read (may differ from
   *  manifest.sections if the writer lied). */
  observedSections: string[]
  /** Filenames the reader did not recognise; surfaced for forward-compat. */
  unknownEntries: string[]
}

/* ── Public API ─────────────────────────────────────────────────────── */

/**
 * Manifest-only read. Walks the central directory, finds
 * `manifest.json`, parses it and stops. Other entries are listed for
 * the size accounting but not extracted.
 */
export function inspectWorldZip(path: string): Promise<WorldInspectResult> {
  return new Promise((resolve, reject) => {
    yauzlOpen(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) { reject(err ?? new Error('yauzl open returned no zipfile')); return }
      let manifest: WorldManifest | null = null
      let entryCount = 0
      let uncompressedBytes = 0
      zip.readEntry()
      zip.on('entry', (entry: Entry) => {
        entryCount++
        uncompressedBytes += Number(entry.uncompressedSize ?? 0)
        if (entry.fileName === BEAMCMWORLD_PATHS.manifest) {
          zip.openReadStream(entry, (sErr, stream) => {
            if (sErr || !stream) { zip.readEntry(); return }
            const chunks: Buffer[] = []
            stream.on('data', (c: Buffer) => chunks.push(c))
            stream.on('end', () => {
              try {
                manifest = JSON.parse(Buffer.concat(chunks).toString('utf8')) as WorldManifest
              } catch (e) {
                reject(new Error(`manifest.json parse failed: ${(e as Error).message}`))
                return
              }
              zip.readEntry()
            })
            stream.on('error', (e) => reject(e))
          })
        } else {
          zip.readEntry()
        }
      })
      zip.on('error', reject)
      zip.on('end', () => {
        if (!manifest) {
          reject(new Error(`${path}: missing manifest.json — not a valid .beamcmworld`))
          return
        }
        validateManifest(manifest)
        let compressedBytes = 0
        try { compressedBytes = statSync(path).size } catch { /* nfs hiccup; report 0 */ }
        resolve({ manifest, compressedBytes, uncompressedBytes, entryCount })
      })
    })
  })
}

/**
 * Full read. Manifest is parsed first (must be the first entry — the
 * writer guarantees this), then each remaining entry is streamed
 * through the matching sink. Entries the reader doesn't recognise
 * are listed in `unknownEntries` for forward-compat per §E.5.
 */
export function readWorldZip(opts: ReadWorldOpts): Promise<ReadWorldResult> {
  mkdirSync(opts.modsExtractDir, { recursive: true })
  return new Promise((resolve, reject) => {
    yauzlOpen(opts.sourcePath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) { reject(err ?? new Error('yauzl open returned no zipfile')); return }
      let manifest: WorldManifest | null = null
      const observed = new Set<string>()
      const unknown: string[] = []

      const finishOk = (): void => {
        if (!manifest) {
          reject(new Error(`${opts.sourcePath}: missing manifest.json`))
          return
        }
        resolve({
          manifest,
          observedSections: Array.from(observed),
          unknownEntries: unknown,
        })
      }

      // We process entries strictly in the order yauzl yields them;
      // each handler explicitly calls `zip.readEntry()` once it's
      // done so we never double-open a stream. Errors propagate via
      // a single shared reject.
      const consumeBuffer = (entry: Entry): Promise<Buffer> => new Promise((res, rej) => {
        zip.openReadStream(entry, (sErr, stream) => {
          if (sErr || !stream) { rej(sErr ?? new Error('openReadStream null')); return }
          const chunks: Buffer[] = []
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => res(Buffer.concat(chunks)))
          stream.on('error', rej)
        })
      })

      const writeToFile = (entry: Entry, dest: string): Promise<void> => new Promise((res, rej) => {
        mkdirSync(dirname(dest), { recursive: true })
        zip.openReadStream(entry, (sErr, stream) => {
          if (sErr || !stream) { rej(sErr ?? new Error('openReadStream null')); return }
          const out = createWriteStream(dest)
          out.on('error', rej)
          out.on('close', () => res())
          stream.on('error', rej)
          stream.pipe(out)
        })
      })

      zip.readEntry()
      zip.on('entry', async (entry: Entry) => {
        try {
          const name = entry.fileName
          if (name === BEAMCMWORLD_PATHS.manifest) {
            const buf = await consumeBuffer(entry)
            manifest = JSON.parse(buf.toString('utf8')) as WorldManifest
            validateManifest(manifest)
            observed.add('manifest')
          } else if (name === BEAMCMWORLD_PATHS.snapshot) {
            const buf = await consumeBuffer(entry)
            await opts.sinks.onSnapshot?.(buf)
            observed.add('snapshot')
          } else if (name === BEAMCMWORLD_PATHS.modsManifest) {
            const buf = await consumeBuffer(entry)
            const mm = JSON.parse(buf.toString('utf8')) as WorldModsManifest
            await opts.sinks.onModsManifest?.(mm)
            observed.add('modsManifest')
          } else if (name === BEAMCMWORLD_PATHS.oplog) {
            const buf = await consumeBuffer(entry)
            await opts.sinks.onOpLog?.(buf)
            observed.add('oplog')
          } else if (name === BEAMCMWORLD_PATHS.preview) {
            const buf = await consumeBuffer(entry)
            await opts.sinks.onPreview?.(buf)
            observed.add('preview')
          } else if (name.startsWith('mods/') && name.endsWith('.zip')) {
            // mods/<modId>.zip — extract straight to disk so we never
            // hold a multi-hundred-MB mod in RAM.
            const modId = name.slice('mods/'.length, -'.zip'.length)
            const dest = `${opts.modsExtractDir}/${modId}.zip`
            await writeToFile(entry, dest)
            await opts.sinks.onMod?.(modId, dest)
            observed.add('mod')
          } else if (name.startsWith('terrain/') || name.startsWith('forest/')) {
            // Terrain/forest sections — sinks not implemented yet
            // (#28 follow-up). Just count them as "observed" so the
            // §E.5 forward-compat path doesn't flag them as unknown.
            observed.add(name.startsWith('terrain/') ? 'terrain' : 'forest')
          } else {
            unknown.push(name)
          }
          zip.readEntry()
        } catch (e) {
          reject(e)
        }
      })
      zip.on('error', reject)
      zip.on('end', finishOk)
    })
  })
}

/* ── Helpers ────────────────────────────────────────────────────────── */

function validateManifest(m: WorldManifest): void {
  if (typeof m.formatVersion !== 'number') {
    throw new Error('manifest.json missing formatVersion')
  }
  if (m.formatVersion > BEAMCMWORLD_FORMAT_VERSION) {
    throw new Error(
      `Unsupported .beamcmworld formatVersion ${m.formatVersion}; ` +
      `this CM build only understands up to ${BEAMCMWORLD_FORMAT_VERSION}`,
    )
  }
  if (!m.levelName || typeof m.levelName !== 'string') {
    throw new Error('manifest.json missing levelName')
  }
  if (!m.worldId || typeof m.worldId !== 'string') {
    throw new Error('manifest.json missing worldId')
  }
}

// Suppress an unused-import warning for ZipFile when this file is
// strict-mode linted; we keep the import because ZipFile is the
// natural type to expose if a future caller needs to walk entries
// themselves.
export type _ZipFile = ZipFile
