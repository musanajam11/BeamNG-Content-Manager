import { readFile, writeFile, mkdir, readdir, rename as fsRename, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { isModArchive, stripArchiveExt } from '../utils/archiveConverter'
import type { LoadOrderData } from '../../shared/types'

/** Strip UTF-8 BOM if present */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

const PREFIX_RE = /^\d{3}_/

/**
 * Manages mod load order persistence and optional filesystem enforcement
 * via numeric filename prefixes.
 *
 * Load order is stored in our own config files — never in BeamNG's db.json.
 * - Client mods:  %APPDATA%/BeamMP-ContentManager/mod-load-order.json
 * - Server mods:  servers/<id>/mod-load-order.json
 */
export class LoadOrderService {
  private appDataDir: string

  constructor() {
    this.appDataDir = join(app.getPath('appData'), 'BeamMP-ContentManager')
  }

  /* ── Client mod ordering ── */

  private get clientOrderPath(): string {
    return join(this.appDataDir, 'mod-load-order.json')
  }

  async getClientOrder(): Promise<LoadOrderData> {
    return this.readOrderFile(this.clientOrderPath)
  }

  async setClientOrder(orderedKeys: string[]): Promise<LoadOrderData> {
    const data = this.buildOrderData(orderedKeys)
    await this.writeOrderFile(this.clientOrderPath, data)
    return data
  }

  async removeClientEntry(modKey: string): Promise<void> {
    const data = await this.getClientOrder()
    if (modKey in data.orders) {
      delete data.orders[modKey]
      // Re-compact positions
      const sorted = Object.entries(data.orders).sort(([, a], [, b]) => a - b)
      data.orders = {}
      sorted.forEach(([key], i) => {
        data.orders[key] = i
      })
      await this.writeOrderFile(this.clientOrderPath, data)
    }
  }

  /* ── Server mod ordering ── */

  serverOrderPath(serverId: string): string {
    return join(this.appDataDir, 'servers', serverId, 'mod-load-order.json')
  }

  async getServerOrder(serverId: string): Promise<LoadOrderData> {
    return this.readOrderFile(this.serverOrderPath(serverId))
  }

  async setServerOrder(serverId: string, orderedKeys: string[]): Promise<LoadOrderData> {
    const data = this.buildOrderData(orderedKeys)
    await this.writeOrderFile(this.serverOrderPath(serverId), data)
    return data
  }

  async removeServerEntry(serverId: string, modKey: string): Promise<void> {
    const data = await this.getServerOrder(serverId)
    if (modKey in data.orders) {
      delete data.orders[modKey]
      const sorted = Object.entries(data.orders).sort(([, a], [, b]) => a - b)
      data.orders = {}
      sorted.forEach(([key], i) => {
        data.orders[key] = i
      })
      await this.writeOrderFile(this.serverOrderPath(serverId), data)
    }
  }

  /* ── Filename prefix enforcement ── */

  /**
   * Apply numeric prefix enforcement to the client mods directory.
   * Renames files to NNN_original.zip and updates db.json.
   */
  async applyPrefixes(userDir: string): Promise<void> {
    const order = await this.getClientOrder()
    const modsRoot = join(userDir, 'mods')
    const dbPath = join(modsRoot, 'db.json')

    // Load db.json
    let db: Record<string, unknown> = {}
    try {
      const raw = await readFile(dbPath, 'utf-8')
      db = JSON.parse(stripBom(raw))
    } catch {
      return
    }

    const modsMap = this.getModsMap(db)

    // Sort entries by load order then apply prefixes
    const entries = Object.entries(modsMap)

    for (const [key, entry] of entries) {
      if (!entry.filename) continue
      const position = order.orders[key]
      if (position === undefined) continue

      const stripped = entry.filename.replace(PREFIX_RE, '')
      const prefixed = `${String(position).padStart(3, '0')}_${stripped}`

      if (entry.filename === prefixed) continue

      // Determine file directory
      const dirName = this.detectSubDir(entry.dirname)
      const oldPath = join(modsRoot, dirName, entry.filename)
      const newPath = join(modsRoot, dirName, prefixed)

      try {
        await stat(oldPath)
        await fsRename(oldPath, newPath)
      } catch {
        continue // file missing on disk
      }

      // Update db.json entry
      const newKey = stripArchiveExt(prefixed).toLowerCase()
      entry.filename = prefixed
      entry.fullpath = newPath
      // If key changed, move the entry
      if (newKey !== key) {
        delete modsMap[key]
        modsMap[newKey] = entry
        // Update load order keys too
        if (key in order.orders) {
          order.orders[newKey] = order.orders[key]
          delete order.orders[key]
        }
      }
    }

    // Write back
    const output = this.buildDbJson(db, modsMap)
    await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')
    await this.writeOrderFile(this.clientOrderPath, order)
  }

  /**
   * Strip all numeric prefixes from mod filenames and update db.json.
   */
  async stripPrefixes(userDir: string): Promise<void> {
    const modsRoot = join(userDir, 'mods')
    const dbPath = join(modsRoot, 'db.json')

    let db: Record<string, unknown> = {}
    try {
      const raw = await readFile(dbPath, 'utf-8')
      db = JSON.parse(stripBom(raw))
    } catch {
      return
    }

    const modsMap = this.getModsMap(db)
    const order = await this.getClientOrder()

    for (const [key, entry] of Object.entries(modsMap)) {
      if (!entry.filename || !PREFIX_RE.test(entry.filename)) continue

      const stripped = entry.filename.replace(PREFIX_RE, '')
      const dirName = this.detectSubDir(entry.dirname)
      const oldPath = join(modsRoot, dirName, entry.filename)
      const newPath = join(modsRoot, dirName, stripped)

      try {
        await stat(oldPath)
        await fsRename(oldPath, newPath)
      } catch {
        continue
      }

      const newKey = stripArchiveExt(stripped).toLowerCase()
      entry.filename = stripped
      entry.fullpath = newPath

      if (newKey !== key) {
        delete modsMap[key]
        modsMap[newKey] = entry
        if (key in order.orders) {
          order.orders[newKey] = order.orders[key]
          delete order.orders[key]
        }
      }
    }

    const output = this.buildDbJson(db, modsMap)
    await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')
    await this.writeOrderFile(this.clientOrderPath, order)
  }

  /**
   * Apply numeric prefix enforcement for a server's Resources/Client/ folder.
   */
  async applyServerPrefixes(serverId: string): Promise<void> {
    const order = await this.getServerOrder(serverId)
    const clientDir = join(this.appDataDir, 'servers', serverId, 'Resources', 'Client')

    if (!existsSync(clientDir)) return

    const files = await readdir(clientDir)
    for (const file of files) {
      if (!isModArchive(file)) continue
      const stripped = file.replace(PREFIX_RE, '')
      const key = stripArchiveExt(stripped).toLowerCase()
      const position = order.orders[key]
      if (position === undefined) continue

      const prefixed = `${String(position).padStart(3, '0')}_${stripped}`
      if (file === prefixed) continue

      const oldPath = join(clientDir, file)
      const newPath = join(clientDir, prefixed)
      try {
        await fsRename(oldPath, newPath)
      } catch {
        // ignore
      }
    }
  }

  /**
   * Strip all numeric prefixes from a server's Resources/Client/ folder.
   */
  async stripServerPrefixes(serverId: string): Promise<void> {
    const clientDir = join(this.appDataDir, 'servers', serverId, 'Resources', 'Client')

    if (!existsSync(clientDir)) return

    const files = await readdir(clientDir)
    for (const file of files) {
      if (!isModArchive(file) || !PREFIX_RE.test(file)) continue
      const stripped = file.replace(PREFIX_RE, '')
      const oldPath = join(clientDir, file)
      const newPath = join(clientDir, stripped)
      try {
        await fsRename(oldPath, newPath)
      } catch {
        // ignore
      }
    }
  }

  /* ── Internal helpers ── */

  private buildOrderData(orderedKeys: string[]): LoadOrderData {
    const orders: Record<string, number> = {}
    orderedKeys.forEach((key, i) => {
      orders[key] = i
    })
    return { version: 1, orders }
  }

  private async readOrderFile(path: string): Promise<LoadOrderData> {
    try {
      if (existsSync(path)) {
        const raw = await readFile(path, 'utf-8')
        const parsed = JSON.parse(stripBom(raw))
        if (parsed.version === 1 && parsed.orders) return parsed
      }
    } catch {
      // corrupt file — return empty
    }
    return { version: 1, orders: {} }
  }

  private async writeOrderFile(path: string, data: LoadOrderData): Promise<void> {
    const dir = join(path, '..')
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
  }

  /** Resolve the mods map from db.json (handles both wrapped and flat format) */
  private getModsMap(db: Record<string, unknown>): Record<string, DbEntry> {
    if (db.mods && typeof db.mods === 'object' && !Array.isArray(db.mods)) {
      return db.mods as Record<string, DbEntry>
    }
    const result: Record<string, DbEntry> = {}
    for (const [k, v] of Object.entries(db)) {
      if (k === 'header') continue
      if (v && typeof v === 'object' && 'filename' in (v as Record<string, unknown>)) {
        result[k] = v as DbEntry
      }
    }
    return result
  }

  private buildDbJson(db: Record<string, unknown>, modsMap: Record<string, DbEntry>): Record<string, unknown> {
    if (db.mods && typeof db.mods === 'object' && !Array.isArray(db.mods)) {
      return { ...db, mods: modsMap }
    }
    const result: Record<string, unknown> = {}
    if (db.header) result.header = db.header
    Object.assign(result, modsMap)
    return result
  }

  private detectSubDir(dirname: string | undefined): string {
    if (!dirname) return ''
    const norm = dirname.replace(/\\/g, '/')
    if (norm.endsWith('/repo') || norm.includes('/mods/repo')) return 'repo'
    if (norm.endsWith('/multiplayer') || norm.includes('/mods/multiplayer')) return 'multiplayer'
    return ''
  }
}

interface DbEntry {
  active: boolean
  filename: string
  fullpath: string
  dirname: string
  modType: string
  modData?: Record<string, unknown>
  stat?: Record<string, unknown>
  resourceId?: number
  multiplayerScope?: string | null
}
