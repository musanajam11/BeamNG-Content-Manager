import { listEntriesDeep } from '../utils/archiveConverter'
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
   * Scan all mods for overlapping file paths.
   * Includes both enabled and disabled mods so users can see
   * conflicts before toggling a mod on.
   * Returns cached result if available.
   */
  async scanConflicts(mods: ModInfo[], loadOrder: LoadOrderData): Promise<ModConflictReport> {
    if (this.cache) return this.cache

    const fileIndex: Map<string, Array<{ modKey: string; loadOrder: number; enabled: boolean }>> = new Map()

    // Build effective load order: use explicit order if set, otherwise
    // derive from alphabetical filename order (how BeamNG actually loads mods)
    const alphabeticOrder = [...mods]
      .sort((a, b) => a.fileName.toLowerCase().localeCompare(b.fileName.toLowerCase()))
      .reduce<Record<string, number>>((acc, mod, i) => { acc[mod.key] = i; return acc }, {})

    console.log(`[ConflictDetection] Scanning ${mods.length} mods for conflicts...`)

    // List all file entries in each mod zip (enabled AND disabled)
    for (const mod of mods) {
      const order = loadOrder.orders[mod.key] ?? alphabeticOrder[mod.key] ?? 999
      try {
        const entries = await this.listZipEntries(mod.filePath)
        console.log(`[ConflictDetection]   ${mod.key} (${mod.fileName}): ${entries.length} entries, enabled=${mod.enabled}`)
        for (const entry of entries) {
          // Skip directories and metadata files
          if (entry.endsWith('/')) continue
          if (entry.startsWith('mod_info/')) continue

          // For inner zip entries (outerPath→innerPath), use only the inner path
          // as the effective game path since BeamNG extracts inner zips flat
          const arrowIdx = entry.indexOf('→')
          const effectivePath = arrowIdx >= 0 ? entry.slice(arrowIdx + 1) : entry

          // Skip inner zip directories
          if (effectivePath.endsWith('/')) continue

          const normalized = effectivePath.toLowerCase()
          if (!fileIndex.has(normalized)) {
            fileIndex.set(normalized, [])
          }
          fileIndex.get(normalized)!.push({ modKey: mod.key, loadOrder: order, enabled: mod.enabled })
        }
      } catch {
        // Cannot read zip — skip this mod
      }
    }

    // Find conflicts (files present in more than one *distinct* mod)
    const conflicts: ModConflict[] = []
    for (const [filePath, modEntries] of fileIndex) {
      // Deduplicate by modKey (same mod can contribute a path from both top level and inner zip)
      const uniqueByMod = new Map<string, { modKey: string; loadOrder: number; enabled: boolean }>()
      for (const e of modEntries) {
        if (!uniqueByMod.has(e.modKey)) uniqueByMod.set(e.modKey, e)
      }
      if (uniqueByMod.size < 2) continue
      // Sort by load order — highest order = last loaded = wins
      const sorted = [...uniqueByMod.values()].sort((a, b) => a.loadOrder - b.loadOrder)
      const winner = sorted[sorted.length - 1].modKey
      conflicts.push({ filePath, mods: sorted, winner })
    }

    // Sort conflicts by number of mods involved (most conflicting first)
    conflicts.sort((a, b) => b.mods.length - a.mods.length)

    console.log(`[ConflictDetection] Found ${conflicts.length} conflicting files across ${fileIndex.size} total unique paths`)
    if (conflicts.length > 0) {
      console.log(`[ConflictDetection] First 5 conflicts:`)
      for (const c of conflicts.slice(0, 5)) {
        console.log(`[ConflictDetection]   ${c.filePath} — ${c.mods.map(m => m.modKey).join(' vs ')} → winner: ${c.winner}`)
      }
    }
    // Debug: show sample paths from a few mods to understand structure
    const sampleMods = ['rls-career-collection-4.7', 'rls_v3.8', 'careermp_v0.0.22', 'beammp']
    for (const mk of sampleMods) {
      const paths: string[] = []
      for (const [fp, entries] of fileIndex) {
        if (entries.some(e => e.modKey === mk)) paths.push(fp)
        if (paths.length >= 10) break
      }
      if (paths.length > 0) console.log(`[ConflictDetection] Sample paths from ${mk}:\n  ${paths.join('\n  ')}`)
    }

    const report: ModConflictReport = {
      conflicts,
      scannedMods: mods.map((m) => m.key),
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

  /** List all file entry paths inside an archive (including inside nested zips) */
  private listZipEntries(archivePath: string): Promise<string[]> {
    return listEntriesDeep(archivePath)
  }
}
