import { readFile, writeFile, readdir, unlink, copyFile, stat } from 'fs/promises'
import { join, basename } from 'path'
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
  active: boolean
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

  /** Read and return the full mod list by combining db.json metadata with disk files */
  async listMods(userDir: string): Promise<ModInfo[]> {
    const modsRoot = join(userDir, 'mods')
    const dbPath = join(modsRoot, 'db.json')

    // Load db.json for metadata
    let db: Record<string, unknown> = {}
    try {
      const raw = await readFile(dbPath, 'utf-8')
      db = JSON.parse(stripBom(raw))
    } catch {
      // db.json may not exist yet — scan disk only
    }

    const modsMap = this.getModsMap(db)
    const mods: ModInfo[] = []
    const seenFiles = new Set<string>()

    // Process db.json entries
    for (const [key, entry] of Object.entries(modsMap)) {
      if (!entry.filename) continue
      seenFiles.add(entry.filename.toLowerCase())

      const location = this.detectLocation(entry.dirname)
      const filePath = join(modsRoot, location === 'repo' ? 'repo' : location === 'multiplayer' ? 'multiplayer' : '', entry.filename)

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
        key,
        fileName: entry.filename,
        filePath,
        sizeBytes,
        modifiedDate,
        enabled: entry.active,
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

    // Scan repo/ for any archives not in db.json
    try {
      const repoDir = join(modsRoot, 'repo')
      const files = await readdir(repoDir)
      for (const file of files) {
        if (!isModArchive(file)) continue
        if (seenFiles.has(file.toLowerCase())) continue

        const filePath = join(repoDir, file)
        const s = await stat(filePath)
        const key = stripArchiveExt(file).toLowerCase()

        // Scan zip for metadata
        const meta = await this.scanModZip(filePath)

        mods.push({
          key,
          fileName: file,
          filePath,
          sizeBytes: s.size,
          modifiedDate: s.mtime.toISOString(),
          enabled: false,
          modType: meta.modType,
          title: meta.title,
          tagLine: meta.tagLine,
          author: meta.author,
          version: meta.version,
          previewImage: null,
          location: 'repo',
          resourceId: null,
          multiplayerScope: null,
          loadOrder: null,
          levelDir: meta.levelDir
        })
      }
    } catch {
      // repo/ folder may not exist
    }

    return mods
  }

  /** Toggle mod active state in db.json */
  async toggleMod(userDir: string, modKey: string, enabled: boolean): Promise<void> {
    const dbPath = join(userDir, 'mods', 'db.json')
    const raw = await readFile(dbPath, 'utf-8')
    const db = JSON.parse(stripBom(raw))
    const modsMap = this.getModsMap(db)

    if (modsMap[modKey]) {
      modsMap[modKey].active = enabled
      const output = this.buildDbJson(db, modsMap)
      await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')
    }
  }

  /** Delete a mod zip from disk and remove its db.json entry */
  async deleteMod(userDir: string, modKey: string): Promise<void> {
    const dbPath = join(userDir, 'mods', 'db.json')

    let db: Record<string, unknown> = {}
    try {
      const raw = await readFile(dbPath, 'utf-8')
      db = JSON.parse(stripBom(raw))
    } catch { /* ignore */ }

    const modsMap = this.getModsMap(db)
    const entry = modsMap[modKey]
    if (entry) {
      // Delete the actual file
      const location = this.detectLocation(entry.dirname)
      const dir = location === 'repo' ? 'repo' : location === 'multiplayer' ? 'multiplayer' : ''
      const filePath = join(userDir, 'mods', dir, entry.filename)
      try {
        await unlink(filePath)
      } catch { /* file may already be gone */ }

      // Remove from db.json
      delete modsMap[modKey]
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
    let db: Record<string, unknown> = {}
    try {
      const raw = await readFile(dbPath, 'utf-8')
      db = JSON.parse(stripBom(raw))
    } catch { /* db.json may not exist */ }

    const modsMap = this.getModsMap(db)
    modsMap[key] = {
      active: true,
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
      enabled: true,
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
    let db: Record<string, unknown> = {}
    try {
      const raw = await readFile(dbPath, 'utf-8')
      db = JSON.parse(stripBom(raw))
    } catch { /* db.json may not exist */ }

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
    let db: Record<string, unknown> = {}
    try {
      const raw = await readFile(dbPath, 'utf-8')
      db = JSON.parse(stripBom(raw))
    } catch { /* db.json may not exist */ }

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
