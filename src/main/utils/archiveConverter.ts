import { open as yauzlOpen, fromBuffer as yauzlFromBuffer, type Entry } from 'yauzl'

// ── Extension helpers ──

const MOD_ARCHIVE_RE = /\.zip$/i

/** Check if a file path has a supported mod archive extension (.zip) */
export function isModArchive(filePath: string): boolean {
  return MOD_ARCHIVE_RE.test(filePath)
}

/** Strip .zip extension from a filename */
export function stripArchiveExt(fileName: string): string {
  return fileName.replace(MOD_ARCHIVE_RE, '')
}

// ── Unified archive reading functions ──

/**
 * Read the first file matching a regex pattern from a zip archive.
 */
export function readFirstMatch(archivePath: string, pattern: RegExp): Promise<Buffer | null> {
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
 * List entries from a zip buffer (for scanning inner zips).
 */
function listEntriesFromBuffer(buf: Buffer): Promise<string[]> {
  return new Promise((resolve) => {
    const entries: string[] = []
    yauzlFromBuffer(buf, { lazyEntries: true }, (err, zipFile) => {
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
 * Deep-list all entries in an archive, recursing into inner .zip files.
 * Inner zip entries are returned as "outerPath→innerPath" so conflicts
 * inside nested zips can be detected.
 * Buffers are released as each inner zip is processed to limit memory usage.
 */
export function listEntriesDeep(archivePath: string): Promise<string[]> {
  return new Promise((resolve) => {
    const entries: string[] = []
    const innerZipQueue: Array<{ outerPath: string; buf: Buffer }> = []
    let pending = 0

    yauzlOpen(archivePath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) { resolve(entries); return }

      zipFile.readEntry()
      zipFile.on('entry', (entry: Entry) => {
        entries.push(entry.fileName)

        // If this entry is a .zip file, extract it for recursive scanning
        if (/\.zip$/i.test(entry.fileName) && !entry.fileName.endsWith('/')) {
          pending++
          zipFile.openReadStream(entry, (sErr, stream) => {
            if (sErr || !stream) { pending--; zipFile.readEntry(); return }
            const chunks: Buffer[] = []
            stream.on('data', (c: Buffer) => chunks.push(c))
            stream.on('end', () => {
              innerZipQueue.push({ outerPath: entry.fileName, buf: Buffer.concat(chunks) })
              pending--
            })
            stream.on('error', () => { pending-- })
          })
        }
        zipFile.readEntry()
      })

      zipFile.on('end', async () => {
        zipFile.close()
        // Wait for any pending stream reads
        while (pending > 0) await new Promise((r) => setTimeout(r, 10))

        // Process inner zips one at a time, releasing each buffer after use
        while (innerZipQueue.length > 0) {
          const item = innerZipQueue.shift()!
          try {
            const innerEntries = await listEntriesFromBuffer(item.buf)
            for (const ie of innerEntries) {
              entries.push(`${item.outerPath}→${ie}`)
            }
          } catch { /* skip unreadable inner zips */ }
          // Buffer is now unreferenced and eligible for GC
        }

        resolve(entries)
      })

      zipFile.on('error', () => resolve(entries))
    })
  })
}

/**
 * Extract a single file by exact path (case-insensitive) from an archive.
 */
export function extractByPath(archivePath: string, entryPath: string): Promise<Buffer | null> {
  const target = entryPath.toLowerCase()
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
