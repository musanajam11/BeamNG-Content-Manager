import { readFile, writeFile, readdir, unlink, copyFile, stat } from 'fs/promises'
import { join, basename, dirname } from 'path'
import { jsonrepair } from 'jsonrepair'
import { isModArchive, stripArchiveExt, forEachMatch, readFirstMatchWithName } from '../utils/archiveConverter'
import type { ModInfo } from '../../shared/types'

/** Strip UTF-8 BOM if present (PowerShell and some editors add it) */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s
}

interface ModZipMeta {
  title: string | null
  tagLine: string | null
  author: string | null
  version: string | null
  modType: string
  iconDataUrl: string | null
  /** Actual directory name under levels/ inside the zip (for terrain mods) */
  levelDir: string | null
}

interface DbEntry {
  active: boolean | string | number
  modname?: string
  filename: string
  fullpath: string
  dirname: string
  modType: string
  modData?: {
    title?: string
    tag_line?: string
    username?: string
    version_string?: string
  }
  stat?: {
    filesize?: number
    modtime?: number
  }
  resourceId?: number
  multiplayerScope?: string | null
  /** Actual directory name under levels/ inside the zip (for terrain mods) */
  levelDir?: string | null
}

export class ModManagerService {
  private isActiveFlag(value: unknown): boolean {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase()
      return v === 'true' || v === '1' || v === 'yes' || v === 'on'
    }
    if (typeof value === 'number') return value !== 0
    return false
  }

  private formatActiveFlag(previous: unknown, enabled: boolean): boolean | string {
    // Preserve on-disk convention when possible. Some BeamNG installs write
    // string flags in db.json; writing the same shape avoids subtle parser edge cases.
    if (typeof previous === 'string') return enabled ? 'true' : 'false'
    return enabled
  }

  /**
   * Read mods/db.json with auto-repair for malformed JSON.
   * On successful repair we persist the fixed file and create a timestamped backup.
   */
  private async loadDbJson(
    dbPath: string,
    options: { allowMissing?: boolean } = {}
  ): Promise<{ db: Record<string, unknown>; parseFailed: boolean }> {
    let raw: string
    try {
      raw = await readFile(dbPath, 'utf-8')
    } catch {
      if (options.allowMissing) return { db: {}, parseFailed: false }
      throw new Error(`Failed to read db.json at ${dbPath}`)
    }

    const normalized = stripBom(raw)
    try {
      return { db: JSON.parse(normalized), parseFailed: false }
    } catch {
      // Try robust repair for legacy/corrupted db.json files.
      try {
        const repaired = jsonrepair(normalized)
        const parsed = JSON.parse(repaired) as Record<string, unknown>
        const backupPath = `${dbPath}.bak.${Date.now()}`
        try {
          await writeFile(backupPath, normalized, 'utf-8')
        } catch { /* best effort */ }
        await writeFile(dbPath, repaired, 'utf-8')
        console.warn(`[ModManager] Auto-repaired malformed db.json and saved backup to ${backupPath}`)
        return { db: parsed, parseFailed: false }
      } catch {
        if (options.allowMissing) {
          console.warn('[ModManager] db.json is malformed and could not be auto-repaired; falling back to disk scan')
          return { db: {}, parseFailed: true }
        }
        throw new Error(`Malformed db.json at ${dbPath} and auto-repair failed`)
      }
    }
  }

  /**
   * Resolve the mods map from db.json.
   * BeamNG uses a wrapped format: { header: {...}, mods: { key: entry, ... } }
   * Our installMod previously wrote flat: { key: entry, ... }
   * This helper handles both formats.
   */
  private getModsMap(db: Record<string, unknown>): Record<string, DbEntry> {
    if (db.mods && typeof db.mods === 'object' && !Array.isArray(db.mods)) {
      return db.mods as Record<string, DbEntry>
    }
    // Flat format (legacy from our install) — return db minus known non-mod keys
    const result: Record<string, DbEntry> = {}
    for (const [k, v] of Object.entries(db)) {
      if (k === 'header') continue
      if (v && typeof v === 'object' && 'filename' in (v as Record<string, unknown>)) {
        result[k] = v as DbEntry
      }
    }
    return result
  }

  /**
   * Write db.json preserving the BeamNG wrapper format.
   * If the original had { header, mods }, we write back in that format.
   */
  private buildDbJson(db: Record<string, unknown>, modsMap: Record<string, DbEntry>): Record<string, unknown> {
    if (db.mods && typeof db.mods === 'object' && !Array.isArray(db.mods)) {
      return { ...db, mods: modsMap }
    }
    // Flat format: reconstruct (keep header if present)
    const result: Record<string, unknown> = {}
    if (db.header) result.header = db.header
    Object.assign(result, modsMap)
    return result
  }

  /** Repair db.json entries that are missing the modname field (prevents BeamMP Lua crash) */
  async repairModNames(userDir: string): Promise<void> {
    const dbPath = join(userDir, 'mods', 'db.json')
    const { db } = await this.loadDbJson(dbPath, { allowMissing: true })

    const modsMap = this.getModsMap(db)
    let dirty = false
    for (const [key, entry] of Object.entries(modsMap)) {
      if (!entry.modname) {
        entry.modname = key
        dirty = true
      }
    }
    if (dirty) {
      const output = this.buildDbJson(db, modsMap)
      await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')
    }
  }

  /**
   * Remove duplicate db.json entries that point at the same filename.
   * Older CM builds (and some BeamNG versions) could leave two entries for
   * the same physical file — e.g. a stale `BeamMP.zip` entry plus the live
   * `mods/multiplayer/BeamMP.zip` entry. We keep the entry that points at the
   * file actually on disk; if both exist on disk we prefer the one in
   * `mods/multiplayer/` for `BeamMP.zip` and otherwise the first encountered.
   */
  async repairDuplicateEntries(userDir: string): Promise<void> {
    const modsRoot = join(userDir, 'mods')
    const dbPath = join(modsRoot, 'db.json')
    const { db } = await this.loadDbJson(dbPath, { allowMissing: true })

    const modsMap = this.getModsMap(db)
    // Group dbKeys by lowercased filename
    const byFilename = new Map<string, string[]>()
    for (const [dbKey, entry] of Object.entries(modsMap)) {
      if (!entry.filename) continue
      const fn = entry.filename.toLowerCase()
      const arr = byFilename.get(fn)
      if (arr) arr.push(dbKey)
      else byFilename.set(fn, [dbKey])
    }

    let dirty = false
    for (const [fileName, dbKeys] of byFilename) {
      if (dbKeys.length < 2) continue

      // Find which entries actually have the file on disk and prefer
      // multiplayer/ for BeamMP.zip.
      let keep: string | null = null
      const candidatesOnDisk: string[] = []
      for (const k of dbKeys) {
        const entry = modsMap[k]
        const location = this.detectLocation(entry.dirname)
        const dir = location === 'repo' ? 'repo' : location === 'multiplayer' ? 'multiplayer' : ''
        const filePath = join(modsRoot, dir, entry.filename)
        try {
          await stat(filePath)
          candidatesOnDisk.push(k)
        } catch { /* not on disk */ }
      }

      const pool = candidatesOnDisk.length > 0 ? candidatesOnDisk : dbKeys
      if (fileName === 'beammp.zip') {
        keep = pool.find((k) => this.detectLocation(modsMap[k].dirname) === 'multiplayer') ?? pool[0]
      } else {
        keep = pool[0]
      }

      for (const k of dbKeys) {
        if (k === keep) continue
        delete modsMap[k]
        dirty = true
      }
    }

    if (dirty) {
      const output = this.buildDbJson(db, modsMap)
      await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')
    }
  }

  /**
   * Ensure BeamMP.zip is represented in db.json and forced active.
   * This is a safety net for installs where the zip exists on disk but BeamNG
   * left (or recreated) an inactive entry, which prevents MP from auto-starting.
   */
  async ensureBeamMPEnabled(userDir: string): Promise<void> {
    const candidateZipPaths: string[] = [
      join(userDir, 'mods', 'multiplayer', 'BeamMP.zip'),
      join(userDir, 'current', 'mods', 'multiplayer', 'BeamMP.zip')
    ]

    // Include numeric version folders (e.g. 0.34) for non-standard layouts.
    try {
      const entries = await readdir(userDir)
      for (const entry of entries) {
        if (/^\d+\.\d+$/.test(entry)) {
          candidateZipPaths.push(join(userDir, entry, 'mods', 'multiplayer', 'BeamMP.zip'))
        }
      }
    } catch { /* userDir may not exist yet */ }

    let beammpZipPath: string | null = null
    for (const p of candidateZipPaths) {
      try {
        const s = await stat(p)
        if (s.isFile()) {
          beammpZipPath = p
          break
        }
      } catch { /* try next candidate */ }
    }
    if (!beammpZipPath) return

    const mpDir = dirname(beammpZipPath)
    const modsRoot = dirname(mpDir)
    const dbPath = join(modsRoot, 'db.json')
    const { db } = await this.loadDbJson(dbPath, { allowMissing: true })

    const modsMap = this.getModsMap(db)
    const beamEntries = Object.entries(modsMap).filter(([, entry]) => (entry.filename || '').toLowerCase() === 'beammp.zip')

    let dirty = false

    // Force all BeamMP entries active so even stale duplicates don't disable MP.
    for (const [, entry] of beamEntries) {
      if (!this.isActiveFlag(entry.active)) {
        entry.active = this.formatActiveFlag(entry.active, true)
        dirty = true
      }
    }

    // Prefer an entry that points at mods/multiplayer.
    const keepKey =
      beamEntries.find(([, entry]) => this.detectLocation(entry.dirname) === 'multiplayer')?.[0]
      ?? beamEntries[0]?.[0]
      ?? 'beammp'

    const zipStat = await stat(beammpZipPath)
    const currentModTime = Math.floor(zipStat.mtimeMs / 1000)

    if (!modsMap[keepKey]) {
      modsMap[keepKey] = {
        active: 'true',
        modname: 'beammp',
        filename: 'BeamMP.zip',
        fullpath: beammpZipPath,
        dirname: mpDir,
        modType: 'unknown',
        stat: {
          filesize: zipStat.size,
          modtime: currentModTime
        }
      }
      dirty = true
    } else {
      const keep = modsMap[keepKey]
      if (!this.isActiveFlag(keep.active)) {
        keep.active = this.formatActiveFlag(keep.active, true)
        dirty = true
      }
      if (keep.modname !== 'beammp') { keep.modname = 'beammp'; dirty = true }
      if (keep.filename !== 'BeamMP.zip') { keep.filename = 'BeamMP.zip'; dirty = true }
      if (keep.fullpath !== beammpZipPath) { keep.fullpath = beammpZipPath; dirty = true }
      if (keep.dirname !== mpDir) { keep.dirname = mpDir; dirty = true }
      if (!keep.stat || keep.stat.filesize !== zipStat.size || keep.stat.modtime !== currentModTime) {
        keep.stat = {
          filesize: zipStat.size,
          modtime: currentModTime
        }
        dirty = true
      }
    }

    if (dirty) {
      const output = this.buildDbJson(db, modsMap)
      await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')
    }
  }

  /** Read and return the full mod list by combining db.json metadata with disk files */
  async listMods(userDir: string): Promise<ModInfo[]> {
    const modsRoot = join(userDir, 'mods')
    const dbPath = join(modsRoot, 'db.json')
    const { db, parseFailed: dbParseFailed } = await this.loadDbJson(dbPath, { allowMissing: true })

    const modsMap = this.getModsMap(db)
    const mods: ModInfo[] = []
    const seenFiles = new Set<string>()

    // Process db.json entries
    for (const [, entry] of Object.entries(modsMap)) {
      if (!entry.filename) continue

      const location = this.detectLocation(entry.dirname)
      const fileName = entry.filename
      const filePath = join(modsRoot, location === 'repo' ? 'repo' : location === 'multiplayer' ? 'multiplayer' : '', fileName)

      // Skip duplicates: db.json occasionally contains multiple entries
      // pointing at the same filename (e.g. a stale BeamMP.zip entry plus the
      // current `mods/multiplayer/BeamMP.zip` entry). The first one we hit
      // wins — without this guard the mod list would render the same file
      // twice with identical metadata.
      const fileNameLower = fileName.toLowerCase()
      if (seenFiles.has(fileNameLower)) continue
      seenFiles.add(fileNameLower)

      let sizeBytes = entry.stat?.filesize ?? 0
      let modifiedDate = entry.stat?.modtime ? new Date(entry.stat.modtime * 1000).toISOString() : ''

      // Verify file exists and get fresh stats if db values missing
      try {
        const s = await stat(filePath)
        if (!sizeBytes) sizeBytes = s.size
        if (!modifiedDate) modifiedDate = s.mtime.toISOString()
      } catch {
        // File listed in db.json but missing from disk — skip
        continue
      }

      mods.push({
        key: stripArchiveExt(fileName).toLowerCase(),
        fileName,
        filePath,
        sizeBytes,
        modifiedDate,
        enabled: this.isActiveFlag(entry.active),
        modType: entry.modType || 'unknown',
        title: entry.modData?.title || null,
        tagLine: entry.modData?.tag_line || null,
        author: entry.modData?.username || null,
        version: entry.modData?.version_string || null,
        previewImage: null,
        location,
        resourceId: entry.resourceId || null,
        multiplayerScope: (entry.multiplayerScope as 'client' | 'server' | 'both') || null,
        loadOrder: null,
        levelDir: entry.levelDir || null
      })
    }

    // Scan disk for archives not present in db.json.
    // Include both repo/ and multiplayer/ so protected mods like BeamMP still
    // appear even if db.json is malformed.
    const scanTargets: Array<{ subDir: string; location: 'repo' | 'multiplayer' }> = [
      { subDir: 'repo', location: 'repo' },
      { subDir: 'multiplayer', location: 'multiplayer' }
    ]
    for (const target of scanTargets) {
      try {
        const dir = join(modsRoot, target.subDir)
        const files = await readdir(dir)
        for (const file of files) {
          if (!isModArchive(file)) continue
          if (seenFiles.has(file.toLowerCase())) continue

          const filePath = join(dir, file)
          const s = await stat(filePath)
          const key = stripArchiveExt(file).toLowerCase()

          // When db.json is malformed, skip deep zip scans to keep listing fast.
          const meta = dbParseFailed
            ? { title: null, tagLine: null, author: null, version: null, modType: 'unknown', iconDataUrl: null, levelDir: null }
            : await this.scanModZip(filePath)

          mods.push({
            key,
            fileName: file,
            filePath,
            sizeBytes: s.size,
            modifiedDate: s.mtime.toISOString(),
            enabled: target.location === 'multiplayer',
            modType: meta.modType,
            title: meta.title,
            tagLine: meta.tagLine,
            author: meta.author,
            version: meta.version,
            previewImage: null,
            location: target.location,
            resourceId: null,
            multiplayerScope: null,
            loadOrder: null,
            levelDir: meta.levelDir
          })
        }
      } catch {
        // target folder may not exist
      }
    }

    return mods
  }

  /**
   * Find a mod entry in modsMap by our computed key.
   * BeamNG uses its own key format in db.json (e.g. full paths) that may differ
   * from our computed key (stripArchiveExt(filename).toLowerCase()).
   * Returns [dbKey, entry] or undefined.
   */
  private findModEntry(
    modsMap: Record<string, DbEntry>,
    modKey: string
  ): [string, DbEntry] | undefined {
    // Direct match first (our own installs use this format)
    if (modsMap[modKey]) return [modKey, modsMap[modKey]]

    // Search by matching filename → our key
    for (const [dbKey, entry] of Object.entries(modsMap)) {
      if (entry.filename && stripArchiveExt(entry.filename).toLowerCase() === modKey) {
        return [dbKey, entry]
      }
    }
    return undefined
  }

  /** Toggle mod active state in db.json */
  async toggleMod(userDir: string, modKey: string, enabled: boolean): Promise<void> {
    const dbPath = join(userDir, 'mods', 'db.json')
    const { db } = await this.loadDbJson(dbPath, { allowMissing: true })
    const modsMap = this.getModsMap(db)

    const found = this.findModEntry(modsMap, modKey)
    if (found) {
      found[1].active = this.formatActiveFlag(found[1].active, enabled)
      const output = this.buildDbJson(db, modsMap)
      await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')
    } else {
      // Mod exists on disk but not in db.json — create entry
      const repoDir = join(userDir, 'mods', 'repo')
      try {
        const files = await readdir(repoDir)
        const match = files.find((f) => stripArchiveExt(f).toLowerCase() === modKey)
        if (match) {
          const filePath = join(repoDir, match)
          const s = await stat(filePath)
          modsMap[modKey] = {
            active: enabled ? 'true' : 'false',
            modname: modKey,
            filename: match,
            fullpath: filePath,
            dirname: repoDir,
            modType: 'unknown',
            stat: {
              filesize: s.size,
              modtime: Math.floor(s.mtimeMs / 1000)
            }
          }
          const output = this.buildDbJson(db, modsMap)
          await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')
        }
      } catch { /* repo dir may not exist */ }
    }
  }

  /** Delete a mod zip from disk and remove its db.json entry */
  async deleteMod(userDir: string, modKey: string): Promise<void> {
    const dbPath = join(userDir, 'mods', 'db.json')
    const { db } = await this.loadDbJson(dbPath, { allowMissing: true })

    const modsMap = this.getModsMap(db)
    const found = this.findModEntry(modsMap, modKey)
    if (found) {
      const [dbKey, entry] = found
      // Delete the actual file
      const location = this.detectLocation(entry.dirname)
      const dir = location === 'repo' ? 'repo' : location === 'multiplayer' ? 'multiplayer' : ''
      const filePath = join(userDir, 'mods', dir, entry.filename)
      try {
        await unlink(filePath)
      } catch { /* file may already be gone */ }

      // Remove from db.json
      delete modsMap[dbKey]
      const output = this.buildDbJson(db, modsMap)
      await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')
    } else {
      // Not in db — try to find matching zip in repo/
      const repoDir = join(userDir, 'mods', 'repo')
      const files = await readdir(repoDir)
      const match = files.find((f) => stripArchiveExt(f).toLowerCase() === modKey)
      if (match) {
        await unlink(join(repoDir, match))
      }
    }
  }

  /** Install a mod by copying a zip file into mods/repo/ and writing db.json metadata */
  async installMod(userDir: string, sourcePath: string, originalFileName?: string, resourceId?: number): Promise<ModInfo> {
    const repoDir = join(userDir, 'mods', 'repo')
    // Use original filename if provided (strips temp download prefix)
    const fileName = originalFileName || basename(sourcePath)
    const destPath = join(repoDir, fileName)

    await copyFile(sourcePath, destPath)
    const s = await stat(destPath)
    const key = stripArchiveExt(fileName).toLowerCase()

    // Scan archive for metadata
    const meta = await this.scanModZip(destPath)

    // Write to db.json
    const dbPath = join(userDir, 'mods', 'db.json')
    const { db } = await this.loadDbJson(dbPath, { allowMissing: true })

    const modsMap = this.getModsMap(db)
    modsMap[key] = {
      active: 'false',
      modname: key,
      filename: fileName,
      fullpath: destPath,
      dirname: repoDir,
      modType: meta.modType,
      modData: {
        title: meta.title || undefined,
        tag_line: meta.tagLine || undefined,
        username: meta.author || undefined,
        version_string: meta.version || undefined
      },
      stat: {
        filesize: s.size,
        modtime: Math.floor(s.mtimeMs / 1000)
      },
      resourceId: resourceId || undefined,
      levelDir: meta.levelDir || undefined
    }
    const output = this.buildDbJson(db, modsMap)
    await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')

    return {
      key,
      fileName,
      filePath: destPath,
      sizeBytes: s.size,
      modifiedDate: s.mtime.toISOString(),
      enabled: false,
      modType: meta.modType,
      title: meta.title,
      tagLine: meta.tagLine,
      author: meta.author,
      version: meta.version,
      previewImage: meta.iconDataUrl,
      location: 'repo',
      resourceId: resourceId || null,
      multiplayerScope: null,
      loadOrder: null,
      levelDir: meta.levelDir
    }
  }

  async updateModScope(userDir: string, modKey: string, scope: 'client' | 'server' | 'both'): Promise<void> {
    const dbPath = join(userDir, 'mods', 'db.json')
    const { db } = await this.loadDbJson(dbPath, { allowMissing: true })

    const modsMap = this.getModsMap(db)
    const entry = modsMap[modKey]
    if (!entry) return
    entry.multiplayerScope = scope
    const output = this.buildDbJson(db, modsMap)
    await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')
  }

  /** Manually override the mod type classification in db.json */
  async updateModType(userDir: string, modKey: string, modType: string): Promise<void> {
    const dbPath = join(userDir, 'mods', 'db.json')
    const { db } = await this.loadDbJson(dbPath, { allowMissing: true })

    const modsMap = this.getModsMap(db)
    const entry = modsMap[modKey]
    if (!entry) return
    entry.modType = modType

    // If reclassifying as terrain and levelDir is missing, re-scan the zip for it
    if (modType === 'terrain' && !entry.levelDir && entry.fullpath) {
      try {
        const meta = await this.scanModZip(entry.fullpath)
        if (meta.levelDir) entry.levelDir = meta.levelDir
      } catch { /* best effort */ }
    }

    const output = this.buildDbJson(db, modsMap)
    await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')
  }

  /** Extract metadata and icon from a mod archive (single pass) */
  private async scanModZip(archivePath: string): Promise<ModZipMeta> {
    const result: ModZipMeta = {
      title: null, tagLine: null, author: null, version: null,
      modType: 'unknown', iconDataUrl: null, levelDir: null
    }

    let hasVehicles = false
    let hasLevels = false
    let hasSounds = false
    let hasUI = false

    await forEachMatch(
      archivePath,
      () => true, // match all entries to detect mod type from paths
      (name, data) => {
        // Detect mod type from directory structure
        if (name.startsWith('vehicles/')) hasVehicles = true
        if (name.startsWith('levels/')) {
          hasLevels = true
          if (!result.levelDir) {
            const parts = name.split('/')
            if (parts.length >= 2 && parts[1]) result.levelDir = parts[1]
          }
        }
        if (name.startsWith('sounds/') || name.startsWith('art/sound/')) hasSounds = true
        if (name.startsWith('ui/modules/apps/') || name.startsWith('ui/entrypoints/')) hasUI = true

        // Read mod_info/<id>/info.json
        if (/^mod_info\/[^/]+\/info\.json$/i.test(name) && !result.title) {
          try {
            const info = JSON.parse(data.toString('utf-8'))
            result.title = info.title || null
            result.tagLine = info.tag_line || null
            result.author = info.username || null
            result.version = info.version_string || null
          } catch { /* malformed json */ }
        }

        // Read mod_info/<id>/icon.jpg|png
        if (/^mod_info\/[^/]+\/icon\.(jpe?g|png)$/i.test(name) && !result.iconDataUrl) {
          const ext = name.split('.').pop()?.toLowerCase() || 'jpg'
          const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
          result.iconDataUrl = `data:${mime};base64,${data.toString('base64')}`
        }
      }
    )

    if (hasLevels) result.modType = 'terrain'
    else if (hasVehicles) result.modType = 'vehicle'
    else if (hasSounds) result.modType = 'sound'
    else if (hasUI) result.modType = 'ui_app'

    return result
  }

  /** Extract the preview icon from a mod archive as a data: URL */
  async getModPreview(archivePath: string): Promise<string | null> {
    const result = await readFirstMatchWithName(archivePath, /^mod_info\/[^/]+\/icon\.(jpe?g|png)$/i)
    if (!result) return null
    const ext = result.fileName.split('.').pop()?.toLowerCase() || 'jpg'
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
    return `data:${mime};base64,${result.data.toString('base64')}`
  }

  /** Open the mods folder in the system file explorer */
  async getModsPath(userDir: string): Promise<string> {
    return join(userDir, 'mods', 'repo')
  }

  private detectLocation(dirname: string): 'repo' | 'multiplayer' | 'other' {
    if (!dirname) return 'other'
    const d = dirname.replace(/\\/g, '/').toLowerCase()
    if (d.includes('/mods/repo')) return 'repo'
    if (d.includes('/mods/multiplayer')) return 'multiplayer'
    return 'other'
  }
}
