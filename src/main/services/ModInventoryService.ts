/**
 * ModInventoryService — Tier 4 Phase 3 coop mod sharing (§3).
 *
 * Builds a `ModManifest` for the host peer to advertise in its
 * `WelcomeWithMods` frame, and runs the joiner-side diff (sha256 → id+version
 * → missing) so a joiner knows which mods it must download before loading
 * the host's level.
 *
 * Intentionally standalone from `ModManagerService` — that service owns
 * install/toggle/delete of the user's main mod library; this one is
 * read-only at build time and plugs into the HTTP share route + joiner
 * staging flow (#17–#19).
 *
 * Wire contract (see `Docs/WORLD-EDITOR-SYNC.md` §3 "ModManifest shape"):
 *   ModManifestEntry { id, fileName, sha256, sizeBytes, modType,
 *                      title, version, multiplayerScope, resourceId,
 *                      declaredBy }
 *   ModManifest      { beamngBuild, levelDependencies, entries }
 *
 * Hashing is incremental via `crypto.createHash('sha256')` so 500 MB+
 * zips don't pin the whole file in memory.
 */
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import type { ModInfo } from '../../shared/types'

export interface ModManifestEntry {
  id: string
  fileName: string
  sha256: string
  sizeBytes: number
  modType: string
  title: string | null
  version: string | null
  /** 'server'-only mods are excluded at build time; only client/both here. */
  multiplayerScope: 'client' | 'both' | null
  resourceId: number | null
  /** Who authored this entry — host library vs CM-project declaration. */
  declaredBy: 'host-local' | 'cm-project'
}

export interface ModManifest {
  beamngBuild: string
  /** Mod filenames the level explicitly references (ordering hint). */
  levelDependencies: string[]
  entries: ModManifestEntry[]
}

/** Joiner-side diff outcome. */
export interface ModDiffResult {
  /** Manifest ids the joiner is missing and must download. */
  missingIds: string[]
  /** Ids matched exactly by sha256 — safe to use as-is. */
  exactMatchIds: string[]
  /** Ids matched by (id, version) but sha differs — content drift. */
  driftIds: string[]
  /** Local joiner mods NOT in the manifest; caller disables for the session. */
  localOnlyIds: string[]
}

export class ModInventoryService {
  /**
   * Stream `sha256` of a file. Chunked so a multi-GB mod zip doesn't
   * balloon process RSS. Uses Node's built-in crypto (OpenSSL underneath)
   * so throughput matches the OS read speed on modern hardware.
   */
  async sha256File(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const h = createHash('sha256')
      const s = createReadStream(filePath)
      s.on('error', reject)
      s.on('data', (c) => h.update(c))
      s.on('end', () => resolve(h.digest('hex')))
    })
  }

  /**
   * Build one manifest entry from an installed `ModInfo`. `filePath` is the
   * absolute path of the mod zip on disk; we hash it here. Returns null if
   * the file is missing or unreadable — callers skip those silently so a
   * broken library entry doesn't fail the whole welcome frame.
   */
  async buildEntry(
    mod: ModInfo,
    filePath: string,
    declaredBy: 'host-local' | 'cm-project' = 'host-local',
  ): Promise<ModManifestEntry | null> {
    let size = 0
    try {
      const st = await stat(filePath)
      size = st.size
    } catch {
      return null
    }
    let sha: string
    try {
      sha = await this.sha256File(filePath)
    } catch {
      return null
    }
    // Only 'client' / 'both' survive; 'server' is dropped at the caller.
    const scope = mod.multiplayerScope === 'client' || mod.multiplayerScope === 'both'
      ? mod.multiplayerScope
      : null
    return {
      id: mod.key,
      fileName: mod.fileName,
      sha256: sha,
      sizeBytes: size,
      modType: mod.modType ?? 'unknown',
      title: mod.title ?? null,
      version: mod.version ?? null,
      multiplayerScope: scope,
      resourceId: mod.resourceId ?? null,
      declaredBy,
    }
  }

  /**
   * Build a full manifest for a set of installed mods. Filters out any
   * entry flagged `multiplayerScope === 'server'` or `noShare === true`
   * up front — those mods never reach clients. `levelDependencies` is a
   * caller-supplied list of filenames the target level's `info.json`
   * references; we pass it through verbatim so the joiner can prioritise
   * those downloads. Returns `skippedNoShare` so the host UI can warn
   * the user (e.g. "3 paid / no-share mods will not be sent to joiners —
   * they may see missing assets").
   */
  async buildManifest(
    mods: ModInfo[],
    modPathResolver: (mod: ModInfo) => string,
    beamngBuild: string,
    levelDependencies: string[] = [],
  ): Promise<{ manifest: ModManifest; skippedNoShare: string[] }> {
    const entries: ModManifestEntry[] = []
    const skippedNoShare: string[] = []
    for (const mod of mods) {
      if (mod.multiplayerScope === 'server') continue
      if (mod.noShare === true) {
        skippedNoShare.push(mod.key)
        continue
      }
      const entry = await this.buildEntry(mod, modPathResolver(mod), 'host-local')
      if (entry) entries.push(entry)
    }
    return { manifest: { beamngBuild, levelDependencies, entries }, skippedNoShare }
  }

  /**
   * Joiner-side diff. Compares the incoming manifest against the joiner's
   * local mod library and classifies every entry into one of four buckets
   * (see `ModDiffResult`). Caller handles the action — download missing,
   * warn on drift, disable local-only for the session.
   *
   * `localMods` carries the joiner's current library with file hashes
   * already computed (we don't hash here to avoid a double walk — the
   * joiner hashes on session entry and caches).
   */
  diff(
    manifest: ModManifest,
    localMods: Array<{ id: string; version: string | null; sha256: string }>,
  ): ModDiffResult {
    const localById = new Map<string, { version: string | null; sha256: string }>()
    const localByHash = new Set<string>()
    for (const m of localMods) {
      localById.set(m.id, { version: m.version, sha256: m.sha256 })
      localByHash.add(m.sha256)
    }
    const missingIds: string[] = []
    const exactMatchIds: string[] = []
    const driftIds: string[] = []
    const manifestIds = new Set<string>()
    for (const entry of manifest.entries) {
      manifestIds.add(entry.id)
      if (localByHash.has(entry.sha256)) {
        exactMatchIds.push(entry.id)
        continue
      }
      const local = localById.get(entry.id)
      if (local && local.version && entry.version && local.version === entry.version) {
        // Same id+version but different sha — warn the user; don't re-download.
        driftIds.push(entry.id)
        continue
      }
      missingIds.push(entry.id)
    }
    const localOnlyIds: string[] = []
    for (const m of localMods) {
      if (!manifestIds.has(m.id)) localOnlyIds.push(m.id)
    }
    return { missingIds, exactMatchIds, driftIds, localOnlyIds }
  }

  /**
   * Sum up the bytes a joiner would have to download given a diff result
   * and a manifest. Used by the confirm dialog (#21) to surface a size
   * warning before the joiner commits to a multi-GB transfer.
   */
  downloadSizeBytes(manifest: ModManifest, diff: ModDiffResult): number {
    const byId = new Map(manifest.entries.map((e) => [e.id, e]))
    let total = 0
    for (const id of diff.missingIds) {
      const e = byId.get(id)
      if (e) total += e.sizeBytes
    }
    return total
  }
}
