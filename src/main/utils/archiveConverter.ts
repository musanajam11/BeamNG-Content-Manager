import { readFile as fsReadFile, mkdtemp, rm } from 'fs/promises'
import { createWriteStream } from 'fs'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import { createExtractorFromData } from 'node-unrar-js'
import yazl from 'yazl'
import { open as yauzlOpen, type Entry } from 'yauzl'

// ── Extension helpers ──

const MOD_ARCHIVE_RE = /\.(zip|rar)$/i
const ARCHIVE_EXT_RE = /\.(zip|rar)$/i

/** Check if a file path has a supported mod archive extension (.zip or .rar) */
export function isModArchive(filePath: string): boolean {
  return MOD_ARCHIVE_RE.test(filePath)
}

/** Check if a file path has a .rar extension */
export function isRarFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.rar')
}

/** Strip .zip or .rar extension from a filename */
export function stripArchiveExt(fileName: string): string {
  return fileName.replace(ARCHIVE_EXT_RE, '')
}

// ── RAR extraction helpers (loads entire archive into memory) ──

interface RarEntry {
  fileName: string
  data: Buffer
}

async function loadRarEntries(archivePath: string): Promise<RarEntry[]> {
  const rarBuffer = await fsReadFile(archivePath)
  const extractor = await createExtractorFromData({ data: rarBuffer.buffer.slice(rarBuffer.byteOffset, rarBuffer.byteOffset + rarBuffer.byteLength) as ArrayBuffer })
  const extracted = extractor.extract()
  const results: RarEntry[] = []
  for (const file of extracted.files) {
    if (file.fileHeader.flags.directory) continue
    if (!file.extraction) continue
    results.push({
      fileName: file.fileHeader.name.replace(/\\/g, '/'),
      data: Buffer.from(file.extraction)
    })
  }
  return results
}

// ── Unified archive reading functions ──

/**
 * Read the first file matching a regex pattern from an archive.
 * Works with both .zip and .rar files.
 */
export function readFirstMatch(archivePath: string, pattern: RegExp): Promise<Buffer | null> {
  if (isRarFile(archivePath)) {
    return loadRarEntries(archivePath).then((entries) => {
      const match = entries.find((e) => pattern.test(e.fileName))
      return match ? match.data : null
    }).catch(() => null)
  }
  // ZIP path - use yauzl streaming for efficiency
  return new Promise((resolve) => {
    yauzlOpen(archivePath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(null); return }
      let found = false
      zipFile.readEntry()
      zipFile.on('entry', (entry: Entry) => {
        if (found) return
        if (pattern.test(entry.fileName)) {
          found = true
          zipFile.openReadStream(entry, (sErr, stream) => {
            if (sErr || !stream) { zipFile.close(); resolve(null); return }
            const chunks: Buffer[] = []
            stream.on('data', (c: Buffer) => chunks.push(c))
            stream.on('end', () => { zipFile.close(); resolve(Buffer.concat(chunks)) })
            stream.on('error', () => { zipFile.close(); resolve(null) })
          })
        } else {
          zipFile.readEntry()
        }
      })
      zipFile.on('end', () => { if (!found) resolve(null) })
      zipFile.on('error', () => resolve(null))
    })
  })
}

/**
 * Read the first file matching a regex, returning both the matched filename and data.
 */
export function readFirstMatchWithName(
  archivePath: string, pattern: RegExp
): Promise<{ fileName: string; data: Buffer } | null> {
  if (isRarFile(archivePath)) {
    return loadRarEntries(archivePath).then((entries) => {
      const match = entries.find((e) => pattern.test(e.fileName))
      return match ? { fileName: match.fileName, data: match.data } : null
    }).catch(() => null)
  }
  return new Promise((resolve) => {
    yauzlOpen(archivePath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(null); return }
      let found = false
      zipFile.readEntry()
      zipFile.on('entry', (entry: Entry) => {
        if (found) return
        if (pattern.test(entry.fileName)) {
          found = true
          zipFile.openReadStream(entry, (sErr, stream) => {
            if (sErr || !stream) { zipFile.close(); resolve(null); return }
            const chunks: Buffer[] = []
            stream.on('data', (c: Buffer) => chunks.push(c))
            stream.on('end', () => {
              zipFile.close()
              resolve({ fileName: entry.fileName, data: Buffer.concat(chunks) })
            })
            stream.on('error', () => { zipFile.close(); resolve(null) })
          })
        } else {
          zipFile.readEntry()
        }
      })
      zipFile.on('end', () => { if (!found) resolve(null) })
      zipFile.on('error', () => resolve(null))
    })
  })
}

/**
 * Read multiple named files from an archive in a single pass.
 * Returns a Map of filename → Buffer for each matched file.
 */
export function readMultiple(
  archivePath: string, fileNames: string[]
): Promise<Map<string, Buffer>> {
  const wanted = new Set(fileNames.map((f) => f.replace(/\\/g, '/')))
  if (isRarFile(archivePath)) {
    return loadRarEntries(archivePath).then((entries) => {
      const results = new Map<string, Buffer>()
      for (const e of entries) {
        if (wanted.has(e.fileName)) results.set(e.fileName, e.data)
      }
      return results
    }).catch(() => new Map())
  }
  return new Promise((resolve) => {
    const results = new Map<string, Buffer>()
    yauzlOpen(archivePath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(results); return }
      let pending = 0
      zipFile.readEntry()
      zipFile.on('entry', (entry: Entry) => {
        if (wanted.has(entry.fileName) && !results.has(entry.fileName)) {
          pending++
          zipFile.openReadStream(entry, (sErr, stream) => {
            if (sErr || !stream) { pending--; zipFile.readEntry(); return }
            const chunks: Buffer[] = []
            stream.on('data', (c: Buffer) => chunks.push(c))
            stream.on('end', () => {
              results.set(entry.fileName, Buffer.concat(chunks))
              pending--
              if (results.size === wanted.size) { zipFile.close(); resolve(results) }
              else zipFile.readEntry()
            })
          })
        } else {
          zipFile.readEntry()
        }
      })
      zipFile.on('end', () => { if (pending === 0) resolve(results) })
      zipFile.on('error', () => resolve(results))
    })
  })
}

/**
 * Iterate all matching entries in an archive, calling handler for each match.
 */
export function forEachMatch(
  archivePath: string,
  matcher: (fileName: string) => boolean,
  handler: (fileName: string, data: Buffer) => void
): Promise<void> {
  if (isRarFile(archivePath)) {
    return loadRarEntries(archivePath).then((entries) => {
      for (const e of entries) {
        if (matcher(e.fileName)) handler(e.fileName, e.data)
      }
    }).catch(() => {})
  }
  return new Promise((resolve) => {
    yauzlOpen(archivePath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(); return }
      let pending = 0
      let ended = false
      const checkDone = (): void => { if (ended && pending === 0) { zipFile.close(); resolve() } }
      zipFile.readEntry()
      zipFile.on('entry', (entry: Entry) => {
        if (matcher(entry.fileName)) {
          pending++
          zipFile.openReadStream(entry, (sErr, stream) => {
            if (sErr || !stream) { pending--; checkDone(); zipFile.readEntry(); return }
            const chunks: Buffer[] = []
            stream.on('data', (c: Buffer) => chunks.push(c))
            stream.on('end', () => {
              handler(entry.fileName, Buffer.concat(chunks))
              pending--
              checkDone()
            })
          })
        }
        zipFile.readEntry()
      })
      zipFile.on('end', () => { ended = true; checkDone() })
      zipFile.on('error', () => resolve())
    })
  })
}

/**
 * List all entry file names in an archive.
 */
export function listEntries(archivePath: string): Promise<string[]> {
  if (isRarFile(archivePath)) {
    return loadRarEntries(archivePath)
      .then((entries) => entries.map((e) => e.fileName))
      .catch(() => [])
  }
  return new Promise((resolve) => {
    const entries: string[] = []
    yauzlOpen(archivePath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(entries); return }
      zipFile.readEntry()
      zipFile.on('entry', (entry: Entry) => {
        entries.push(entry.fileName)
        zipFile.readEntry()
      })
      zipFile.on('end', () => { zipFile.close(); resolve(entries) })
      zipFile.on('error', () => resolve(entries))
    })
  })
}

/**
 * Extract a single file by exact path (case-insensitive) from an archive.
 */
export function extractByPath(archivePath: string, entryPath: string): Promise<Buffer | null> {
  const target = entryPath.toLowerCase()
  if (isRarFile(archivePath)) {
    return loadRarEntries(archivePath).then((entries) => {
      const match = entries.find((e) => e.fileName.toLowerCase() === target)
      return match ? match.data : null
    }).catch(() => null)
  }
  return new Promise((resolve) => {
    yauzlOpen(archivePath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(null); return }
      let found = false
      zipFile.readEntry()
      zipFile.on('entry', (entry: Entry) => {
        if (found) return
        if (entry.fileName.toLowerCase() === target) {
          found = true
          zipFile.openReadStream(entry, (sErr, stream) => {
            if (sErr || !stream) { zipFile.close(); resolve(null); return }
            const chunks: Buffer[] = []
            stream.on('data', (c: Buffer) => chunks.push(c))
            stream.on('end', () => { zipFile.close(); resolve(Buffer.concat(chunks)) })
            stream.on('error', () => { zipFile.close(); resolve(null) })
          })
        } else {
          zipFile.readEntry()
        }
      })
      zipFile.on('end', () => { if (!found) resolve(null) })
      zipFile.on('error', () => resolve(null))
    })
  })
}

// ── RAR-to-ZIP conversion ──

/**
 * Convert a .rar file to a .zip in the **same directory**, then delete the
 * original .rar.  Returns the path to the new .zip file.
 * Used by the mod scanner to auto-convert .rar mods so BeamNG can load them.
 */
export async function convertRarToZipInPlace(rarPath: string): Promise<string> {
  const dir = join(rarPath, '..')
  const zipName = basename(rarPath).replace(/\.rar$/i, '.zip')
  const zipPath = join(dir, zipName)

  const entries = await loadRarEntries(rarPath)
  if (entries.length === 0) throw new Error('RAR archive contains no files')

  await new Promise<void>((resolve, reject) => {
    const zipFile = new yazl.ZipFile()
    for (const entry of entries) {
      zipFile.addBuffer(entry.data, entry.fileName)
    }
    const outStream = createWriteStream(zipPath)
    outStream.on('error', reject)
    outStream.on('close', () => resolve())
    zipFile.outputStream.pipe(outStream)
    zipFile.end()
  })

  // Remove original .rar now that the .zip is written
  await rm(rarPath, { force: true })
  return zipPath
}

/**
 * Convert a .rar file to a .zip file.
 * Returns the path to the newly created .zip in a temp directory.
 * Caller is responsible for cleaning up the temp file after use.
 */
export async function convertRarToZip(rarPath: string, zipFileName: string): Promise<string> {
  const entries = await loadRarEntries(rarPath)

  if (entries.length === 0) {
    throw new Error('RAR archive contains no files')
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'beammp-rar-'))
  const zipPath = join(tempDir, zipFileName)

  return new Promise<string>((resolve, reject) => {
    const zipFile = new yazl.ZipFile()
    for (const entry of entries) {
      zipFile.addBuffer(entry.data, entry.fileName)
    }

    const outStream = createWriteStream(zipPath)
    outStream.on('error', (err) => {
      rm(tempDir, { recursive: true, force: true }).catch(() => {})
      reject(err)
    })
    outStream.on('close', () => resolve(zipPath))

    zipFile.outputStream.pipe(outStream)
    zipFile.end()
  })
}
