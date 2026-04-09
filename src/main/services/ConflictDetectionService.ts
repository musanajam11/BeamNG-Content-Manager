import { open as yauzlOpen, type Entry } from 'yauzl'
import type { ModInfo, ModConflict, ModConflictReport, LoadOrderData } from '../../shared/types'

/**
 * Scans active mod zips to detect file-level conflicts (overlapping paths).
 * With load order context, determines which mod "wins" each conflict.
 */
export class ConflictDetectionService {
  private cache: ModConflictReport | null = null

  /** Invalidate cache (call on mod toggle, install, delete, reorder) */
  invalidate(): void {
    this.cache = null
  }

  /**
   * Scan all active mods for overlapping file paths.
   * Returns cached result if available.
   */
  async scanConflicts(mods: ModInfo[], loadOrder: LoadOrderData): Promise<ModConflictReport> {
    if (this.cache) return this.cache

    const activeMods = mods.filter((m) => m.enabled)
    const fileIndex: Map<string, Array<{ modKey: string; loadOrder: number }>> = new Map()

    // List all file entries in each active mod zip
    for (const mod of activeMods) {
      const order = loadOrder.orders[mod.key] ?? 999
      try {
        const entries = await this.listZipEntries(mod.filePath)
        for (const entry of entries) {
          // Skip directories and metadata files
          if (entry.endsWith('/')) continue
          if (entry.startsWith('mod_info/')) continue

          const normalized = entry.toLowerCase()
          if (!fileIndex.has(normalized)) {
            fileIndex.set(normalized, [])
          }
          fileIndex.get(normalized)!.push({ modKey: mod.key, loadOrder: order })
        }
      } catch {
        // Cannot read zip — skip this mod
      }
    }

    // Find conflicts (files present in more than one mod)
    const conflicts: ModConflict[] = []
    for (const [filePath, modEntries] of fileIndex) {
      if (modEntries.length < 2) continue
      // Sort by load order — highest order = last loaded = wins
      const sorted = [...modEntries].sort((a, b) => a.loadOrder - b.loadOrder)
      const winner = sorted[sorted.length - 1].modKey
      conflicts.push({ filePath, mods: sorted, winner })
    }

    // Sort conflicts by number of mods involved (most conflicting first)
    conflicts.sort((a, b) => b.mods.length - a.mods.length)

    const report: ModConflictReport = {
      conflicts,
      scannedMods: activeMods.map((m) => m.key),
      timestamp: Date.now()
    }

    this.cache = report
    return report
  }

  /**
   * Get conflicts for a specific mod from cached report.
   */
  getModConflicts(modKey: string): ModConflict[] {
    if (!this.cache) return []
    return this.cache.conflicts.filter((c) =>
      c.mods.some((m) => m.modKey === modKey)
    )
  }

  /** List all file entry paths inside a zip */
  private listZipEntries(zipPath: string): Promise<string[]> {
    return new Promise((resolve) => {
      const entries: string[] = []
      yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
        if (err || !zipFile) {
          resolve(entries)
          return
        }
        zipFile.readEntry()
        zipFile.on('entry', (entry: Entry) => {
          entries.push(entry.fileName)
          zipFile.readEntry()
        })
        zipFile.on('end', () => {
          zipFile.close()
          resolve(entries)
        })
        zipFile.on('error', () => resolve(entries))
      })
    })
  }
}
