/**
 * CoopSessionStagingService — Tier 4 Phase 3 (§3 staging).
 *
 * Owns the joiner-side filesystem layout for mods downloaded from the host
 * during a coop session, and the corresponding `db.json` bookkeeping.
 *
 * Layout:
 *   <userDir>/mods/multiplayer/session-<id8>/<modFileName>.zip
 *
 * `db.json` entries created here carry an extra `coopSessionId` field and
 * `multiplayerScope: 'coop-session'` so the cleanup pass at session exit
 * (#22) can find and remove them deterministically without touching mods
 * the user installed normally.
 *
 * Intentionally not in `ModManagerService`: the staging dir lives under
 * `mods/multiplayer/` (BeamMP convention), not `mods/repo/`, and the
 * lifecycle is session-scoped rather than user-driven. Keeping it out
 * also means a staging bug can't corrupt the user's main mod library.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

interface StagedDbEntry {
  active: boolean
  modname: string
  filename: string
  fullpath: string
  dirname: string
  modType: string
  modData?: { title?: string; version_string?: string }
  stat?: { filesize?: number; modtime?: number }
  resourceId?: number
  /** Marker recognised by `cleanupSession`; not part of BeamNG's own scopes. */
  multiplayerScope: 'coop-session'
  /** Session id this entry belongs to. */
  coopSessionId: string
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s
}

export class CoopSessionStagingService {
  /** Resolve the staging directory for the given session. */
  stagingDir(userDir: string, sessionId: string): string {
    return join(userDir, 'mods', 'multiplayer', `session-${sessionId.substring(0, 8)}`)
  }

  /** mkdir -p the staging dir and return its absolute path. */
  async ensureStagingDir(userDir: string, sessionId: string): Promise<string> {
    const dir = this.stagingDir(userDir, sessionId)
    await mkdir(dir, { recursive: true })
    return dir
  }

  /**
   * Compute the on-disk destination for one mod entry. Filename is
   * preserved from the manifest so the host's name carries through to
   * `db.json` — easier debugging when comparing host vs joiner libraries.
   */
  destPathFor(userDir: string, sessionId: string, fileName: string): string {
    return join(this.stagingDir(userDir, sessionId), fileName)
  }

  /**
   * Insert (or replace) one staged mod's entry in the joiner's `db.json`.
   * `key` is the manifest id from the host (already lower-cased per
   * `ModManagerService`'s convention). Safe to call multiple times — the
   * entry is idempotently overwritten on each call.
   */
  async registerStagedMod(
    userDir: string,
    sessionId: string,
    entry: {
      key: string
      fileName: string
      modType: string
      sizeBytes: number
      title: string | null
      version: string | null
      resourceId: number | null
    },
  ): Promise<void> {
    const dir = await this.ensureStagingDir(userDir, sessionId)
    const fullpath = join(dir, entry.fileName)
    const dbPath = join(userDir, 'mods', 'db.json')
    let db: Record<string, unknown> = {}
    try {
      const raw = await readFile(dbPath, 'utf-8')
      db = JSON.parse(stripBom(raw))
    } catch { /* db.json may not exist yet */ }

    const modsMap = this.getModsMap(db)
    const staged: StagedDbEntry = {
      active: true,
      modname: entry.key,
      filename: entry.fileName,
      fullpath,
      dirname: dir,
      modType: entry.modType,
      modData: {
        title: entry.title ?? undefined,
        version_string: entry.version ?? undefined,
      },
      stat: { filesize: entry.sizeBytes, modtime: Math.floor(Date.now() / 1000) },
      resourceId: entry.resourceId ?? undefined,
      multiplayerScope: 'coop-session',
      coopSessionId: sessionId.substring(0, 8),
    }
    modsMap[entry.key] = staged as unknown as Record<string, unknown> as never
    const output = this.buildDbJson(db, modsMap)
    await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')
  }

  /**
   * Remove every staged entry for `sessionId` from `db.json` and delete
   * the staging directory. Safe to call when nothing was staged. Returns
   * the number of db entries removed (for logging).
   *
   * Caller is responsible for re-enabling any user mods that were toggled
   * off as part of session entry — that bookkeeping is handled in #22 by
   * the controller, not here.
   */
  async cleanupSession(userDir: string, sessionId: string): Promise<{ removed: number }> {
    const sessionTag = sessionId.substring(0, 8)
    const dbPath = join(userDir, 'mods', 'db.json')
    let removed = 0
    try {
      const raw = await readFile(dbPath, 'utf-8')
      const db = JSON.parse(stripBom(raw))
      const modsMap = this.getModsMap(db)
      for (const [key, entry] of Object.entries(modsMap)) {
        const e = entry as Record<string, unknown>
        if (e.multiplayerScope === 'coop-session' && e.coopSessionId === sessionTag) {
          delete modsMap[key]
          removed++
        }
      }
      const output = this.buildDbJson(db, modsMap)
      await writeFile(dbPath, JSON.stringify(output, null, 3), 'utf-8')
    } catch { /* nothing to clean if db.json missing */ }

    const dir = this.stagingDir(userDir, sessionId)
    if (existsSync(dir)) {
      try { await rm(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
    }
    return { removed }
  }

  /**
   * Verify a staged file is on disk and matches the expected size. Returns
   * true on match. Used by the download driver as a quick "skip if
   * already staged" check before launching another HTTP fetch.
   */
  async hasStaged(userDir: string, sessionId: string, fileName: string, expectedSize: number): Promise<boolean> {
    const p = this.destPathFor(userDir, sessionId, fileName)
    try {
      const s = await stat(p)
      return s.size === expectedSize
    } catch {
      return false
    }
  }

  /** Diagnostic: list every coop-session staging dir under this userDir. */
  async listStagingDirs(userDir: string): Promise<string[]> {
    const root = join(userDir, 'mods', 'multiplayer')
    try {
      const entries = await readdir(root)
      return entries.filter((e) => e.startsWith('session-')).map((e) => join(root, e))
    } catch {
      return []
    }
  }

  /* ── db.json plumbing — copy of ModManagerService helpers ─────────── */

  private getModsMap(db: Record<string, unknown>): Record<string, unknown> {
    if (db.mods && typeof db.mods === 'object' && !Array.isArray(db.mods)) {
      return db.mods as Record<string, unknown>
    }
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(db)) {
      if (k === 'header') continue
      if (v && typeof v === 'object' && 'filename' in (v as Record<string, unknown>)) {
        result[k] = v
      }
    }
    return result
  }

  private buildDbJson(db: Record<string, unknown>, modsMap: Record<string, unknown>): Record<string, unknown> {
    if (db.mods && typeof db.mods === 'object' && !Array.isArray(db.mods)) {
      return { ...db, mods: modsMap }
    }
    const result: Record<string, unknown> = {}
    if (db.header) result.header = db.header
    Object.assign(result, modsMap)
    return result
  }
}
