/**
 * BeamUIFilesService
 *
 * Browse / read / write BeamNG UI source files (HTML, JS, CSS, JSON, Vue, etc.)
 * across multiple roots:
 *   - userDir/ui                    (per-user override layer)
 *   - userDir/mods/unpacked/<mod>/ui  (per-mod overrides — recommended for edits)
 *   - installDir/ui                 (vanilla source — read-only-by-default; clobbered by Steam updates)
 *
 * All paths are validated to stay inside their declared root to prevent traversal.
 *
 * Staging layer
 * ─────────────
 * Saving a file does NOT immediately make it permanent. Instead, the original
 * (if any) is backed up under <userData>/ui-staging/files/<hash> and tracked
 * in <userData>/ui-staging/index.json. Committing a file forgets the backup;
 * reverting restores it. By default all uncommitted changes are reverted when
 * the game process exits.
 *
 * Projects
 * ────────
 * A "project" is a named JSON snapshot of the current set of staged files
 * (rootId + subPath + content). Loading a project re-applies those file
 * contents to disk (auto-staging backups for any not yet staged).
 */
import { promises as fs, existsSync } from 'fs'
import { join, relative, sep, normalize, isAbsolute, dirname } from 'path'
import { createHash } from 'crypto'
import { app } from 'electron'

export type UIRootKind = 'userUi' | 'modUi' | 'installUi'

export interface UIRoot {
  /** Stable identifier sent to the renderer ("userUi", "modUi:beamMP", "installUi", ...) */
  id: string
  /** Display label */
  label: string
  /** Absolute path to the root */
  path: string
  /** Classification — used to apply the install-dir write guard */
  kind: UIRootKind
  /** True when writing is permitted under the current settings. */
  writable: boolean
  /** For modUi roots: the mod folder name. */
  modName?: string
}

export interface UIFileEntry {
  name: string
  isDirectory: boolean
  size: number
  modifiedMs: number
}

export interface ListUIRootsOptions {
  /** When true, also includes the BeamNG install dir UI root (read-only by default). */
  includeInstall: boolean
  /** When true (and includeInstall), the install root is marked writable. */
  installWritable?: boolean
}

/** Persisted record of a file that has been saved-but-not-committed. */
export interface StagedChange {
  rootId: string
  subPath: string
  /** Whether the file existed on disk before the first save (so revert restores; otherwise revert deletes). */
  originalExisted: boolean
  /** Filename (no path) under <userData>/ui-staging/files/ holding the original bytes. Empty string if originalExisted=false. */
  backupName: string
  savedAt: number
  /** Number of times the file has been saved since being staged (informational). */
  saveCount: number
}

interface StagingState {
  version: 1
  changes: StagedChange[]
  autoRevertOnGameExit: boolean
}

export interface ProjectSnapshot {
  name: string
  savedAt: number
  files: Array<{ rootId: string; subPath: string; content: string }>
}

export class BeamUIFilesService {
  private rootsById = new Map<string, UIRoot>()
  private stagingDir: string
  private stagingFilesDir: string
  private stagingIndexPath: string
  private projectsDir: string
  private state: StagingState = { version: 1, changes: [], autoRevertOnGameExit: false }
  private stateLoaded = false

  constructor() {
    const root = join(app.getPath('userData'), 'ui-staging')
    this.stagingDir = root
    this.stagingFilesDir = join(root, 'files')
    this.stagingIndexPath = join(root, 'index.json')
    this.projectsDir = join(app.getPath('userData'), 'ui-projects')
  }

  // ── Staging state persistence ──

  private async ensureStateLoaded(): Promise<void> {
    if (this.stateLoaded) return
    try {
      await fs.mkdir(this.stagingFilesDir, { recursive: true })
      await fs.mkdir(this.projectsDir, { recursive: true })
      if (existsSync(this.stagingIndexPath)) {
        const raw = await fs.readFile(this.stagingIndexPath, 'utf8')
        const parsed = JSON.parse(raw) as StagingState
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.changes)) {
          this.state = {
            version: 1,
            changes: parsed.changes,
            autoRevertOnGameExit: parsed.autoRevertOnGameExit !== false,
          }
        }
      }
    } catch {
      // start with empty state
    }
    this.stateLoaded = true
  }

  private async persistState(): Promise<void> {
    try {
      await fs.mkdir(this.stagingDir, { recursive: true })
      await fs.writeFile(this.stagingIndexPath, JSON.stringify(this.state, null, 2), 'utf8')
    } catch {
      // best-effort
    }
  }

  private findChange(rootId: string, subPath: string): StagedChange | undefined {
    return this.state.changes.find((c) => c.rootId === rootId && c.subPath === subPath)
  }

  private removeChange(rootId: string, subPath: string): void {
    this.state.changes = this.state.changes.filter((c) => !(c.rootId === rootId && c.subPath === subPath))
  }

  private backupNameFor(rootId: string, subPath: string): string {
    const h = createHash('sha1').update(`${rootId}\x00${subPath}\x00${Date.now()}\x00${Math.random()}`).digest('hex')
    return `${h.slice(0, 32)}.bak`
  }

  private backupPath(name: string): string {
    return join(this.stagingFilesDir, name)
  }

  /**
   * Discover available UI roots given the current game paths and the user's
   * "include install dir" preference. Recomputed on every call so any newly
   * unpacked mods show up.
   */
  async listRoots(
    gamePaths: { userDir?: string | null; installDir?: string | null } | null,
    opts: ListUIRootsOptions,
  ): Promise<UIRoot[]> {
    // Note: we DO NOT clear rootsById here. Renderer can race a listDir on a
    // root that was momentarily filtered out (e.g. install root toggle), so we
    // keep all previously-seen roots resolvable. The returned array still
    // reflects the current filter.
    const out: UIRoot[] = []
    const userDir = gamePaths?.userDir ?? null
    const installDir = gamePaths?.installDir ?? null

    // 1) <userDir>  — show whole user folder when it exists; ui/, mods/, settings/ etc. all browsable
    if (userDir && existsSync(userDir)) {
      const r: UIRoot = {
        id: 'userDir',
        label: 'User folder (BeamNG userDir)',
        path: userDir,
        kind: 'userUi',
        writable: true,
      }
      out.push(r)
      this.rootsById.set(r.id, r)
    }

    // 2) <userDir>/mods/unpacked/<mod>  — one root per unpacked mod (whether or not it has ui/)
    if (userDir) {
      const unpacked = join(userDir, 'mods', 'unpacked')
      if (existsSync(unpacked)) {
        try {
          const entries = await fs.readdir(unpacked, { withFileTypes: true })
          for (const e of entries) {
            if (!e.isDirectory()) continue
            const r: UIRoot = {
              id: `modUi:${e.name}`,
              label: `Unpacked mod: ${e.name}`,
              path: join(unpacked, e.name),
              kind: 'modUi',
              writable: true,
              modName: e.name,
            }
            out.push(r)
            this.rootsById.set(r.id, r)
          }
        } catch { /* ignore */ }
      }
    }

    // 3) <installDir>  — opt-in. Show full install folder, not just ui/.
    if (opts.includeInstall && installDir && existsSync(installDir)) {
      const r: UIRoot = {
        id: 'installDir',
        label: 'BeamNG install folder (vanilla)',
        path: installDir,
        kind: 'installUi',
        writable: !!opts.installWritable,
      }
      out.push(r)
      this.rootsById.set(r.id, r)
    }

    return out
  }

  /** Resolve a root id + relative subpath into a validated absolute path. */
  private resolveSafe(rootId: string, subPath: string): { root: UIRoot; abs: string } {
    const root = this.rootsById.get(rootId)
    if (!root) throw new Error(`Unknown UI root: ${rootId}`)
    const cleaned = normalize(subPath ?? '').replace(/^[\\/]+/, '')
    if (isAbsolute(cleaned)) throw new Error('Access denied: absolute path not allowed')
    const abs = normalize(join(root.path, cleaned))
    const rel = relative(root.path, abs)
    if (rel.startsWith('..') || (rel.length > 0 && rel[0] === sep)) {
      throw new Error('Access denied: path outside UI root')
    }
    return { root, abs }
  }

  async listDir(rootId: string, subPath: string): Promise<UIFileEntry[]> {
    const { abs } = this.resolveSafe(rootId, subPath)
    const entries = await fs.readdir(abs, { withFileTypes: true })
    const out: UIFileEntry[] = []
    for (const e of entries) {
      try {
        const full = join(abs, e.name)
        const st = await fs.stat(full)
        out.push({
          name: e.name,
          isDirectory: e.isDirectory(),
          size: st.size,
          modifiedMs: st.mtimeMs,
        })
      } catch { /* skip unreadable entries */ }
    }
    out.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return out
  }

  async readFile(rootId: string, subPath: string): Promise<string> {
    const { abs } = this.resolveSafe(rootId, subPath)
    const buf = await fs.readFile(abs)
    return buf.toString('utf8')
  }

  async writeFile(rootId: string, subPath: string, content: string): Promise<void> {
    const { root, abs } = this.resolveSafe(rootId, subPath)
    if (!root.writable) {
      throw new Error(`UI root "${root.label}" is read-only. Enable writes in settings to modify the install dir.`)
    }
    await this.ensureStateLoaded()
    let entry = this.findChange(rootId, subPath)
    if (!entry) {
      // First save of this file in the current staging session — back up the
      // original (or mark as freshly-created) before writing the new content.
      const originalExisted = existsSync(abs)
      let backupName = ''
      if (originalExisted) {
        backupName = this.backupNameFor(rootId, subPath)
        await fs.mkdir(this.stagingFilesDir, { recursive: true })
        await fs.copyFile(abs, this.backupPath(backupName))
      }
      entry = {
        rootId,
        subPath,
        originalExisted,
        backupName,
        savedAt: Date.now(),
        saveCount: 0,
      }
      this.state.changes.push(entry)
    }
    // Make sure the parent dir exists for fresh files.
    await fs.mkdir(dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
    entry.savedAt = Date.now()
    entry.saveCount += 1
    await this.persistState()
  }

  /** Return the persisted list of saved-but-uncommitted changes. */
  async listStagedChanges(): Promise<StagedChange[]> {
    await this.ensureStateLoaded()
    return [...this.state.changes]
  }

  async getAutoRevertOnExit(): Promise<boolean> {
    await this.ensureStateLoaded()
    return this.state.autoRevertOnGameExit
  }

  async setAutoRevertOnExit(value: boolean): Promise<void> {
    await this.ensureStateLoaded()
    this.state.autoRevertOnGameExit = !!value
    await this.persistState()
  }

  /** Make a previously-saved file permanent (drop the original backup). */
  async commitFile(rootId: string, subPath: string): Promise<void> {
    await this.ensureStateLoaded()
    const entry = this.findChange(rootId, subPath)
    if (!entry) return
    if (entry.backupName) {
      try { await fs.unlink(this.backupPath(entry.backupName)) } catch { /* ignore */ }
    }
    this.removeChange(rootId, subPath)
    await this.persistState()
  }

  async commitAll(): Promise<number> {
    await this.ensureStateLoaded()
    const list = [...this.state.changes]
    for (const c of list) await this.commitFile(c.rootId, c.subPath)
    return list.length
  }

  /**
   * Restore the original file (or delete it if it was created by the user)
   * and forget the staging entry. Falls through silently if the root is no
   * longer registered (e.g. a mod was removed) but still removes the entry.
   */
  async revertFile(rootId: string, subPath: string): Promise<void> {
    await this.ensureStateLoaded()
    const entry = this.findChange(rootId, subPath)
    if (!entry) return
    try {
      const root = this.rootsById.get(rootId)
      if (root) {
        const abs = this.resolveSafe(rootId, subPath).abs
        if (entry.originalExisted && entry.backupName) {
          await fs.mkdir(dirname(abs), { recursive: true })
          await fs.copyFile(this.backupPath(entry.backupName), abs)
        } else {
          // File didn't exist before — delete current.
          try { await fs.unlink(abs) } catch { /* ignore */ }
        }
      }
    } catch {
      // best-effort revert; still drop the entry
    }
    if (entry.backupName) {
      try { await fs.unlink(this.backupPath(entry.backupName)) } catch { /* ignore */ }
    }
    this.removeChange(rootId, subPath)
    await this.persistState()
  }

  async revertAll(): Promise<number> {
    await this.ensureStateLoaded()
    const list = [...this.state.changes]
    for (const c of list) await this.revertFile(c.rootId, c.subPath)
    return list.length
  }

  /**
   * Called by the launcher integration when the BeamNG process exits. Reverts
   * everything currently staged unless the user disabled the behaviour.
   */
  async onGameExited(): Promise<{ reverted: number } | { skipped: true }> {
    await this.ensureStateLoaded()
    if (!this.state.autoRevertOnGameExit) return { skipped: true }
    const n = await this.revertAll()
    return { reverted: n }
  }

  // ── Projects ──

  async listProjects(): Promise<Array<{ name: string; savedAt: number; fileCount: number }>> {
    await this.ensureStateLoaded()
    const out: Array<{ name: string; savedAt: number; fileCount: number }> = []
    try {
      const entries = await fs.readdir(this.projectsDir, { withFileTypes: true })
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.json')) continue
        try {
          const raw = await fs.readFile(join(this.projectsDir, e.name), 'utf8')
          const parsed = JSON.parse(raw) as ProjectSnapshot
          out.push({
            name: parsed.name ?? e.name.replace(/\.json$/, ''),
            savedAt: parsed.savedAt ?? 0,
            fileCount: Array.isArray(parsed.files) ? parsed.files.length : 0,
          })
        } catch { /* skip malformed */ }
      }
    } catch { /* no projects yet */ }
    out.sort((a, b) => b.savedAt - a.savedAt)
    return out
  }

  private projectPath(name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9 _.\-]/g, '_').slice(0, 80)
    if (!safe) throw new Error('Invalid project name')
    return join(this.projectsDir, `${safe}.json`)
  }

  /**
   * Save a snapshot of the currently-staged files (their CURRENT on-disk
   * content) under the given name. Overwrites if the name already exists.
   */
  async saveProject(name: string): Promise<{ savedAt: number; fileCount: number }> {
    await this.ensureStateLoaded()
    const files: ProjectSnapshot['files'] = []
    for (const c of this.state.changes) {
      try {
        const root = this.rootsById.get(c.rootId)
        if (!root) continue
        const abs = this.resolveSafe(c.rootId, c.subPath).abs
        if (!existsSync(abs)) continue
        const content = await fs.readFile(abs, 'utf8')
        files.push({ rootId: c.rootId, subPath: c.subPath, content })
      } catch { /* skip */ }
    }
    const snap: ProjectSnapshot = { name, savedAt: Date.now(), files }
    await fs.mkdir(this.projectsDir, { recursive: true })
    await fs.writeFile(this.projectPath(name), JSON.stringify(snap, null, 2), 'utf8')
    return { savedAt: snap.savedAt, fileCount: files.length }
  }

  /**
   * Load a project: re-applies each file's content via writeFile (which stages
   * a backup of the current on-disk version if not already staged). Returns
   * the count of files applied + any roots/files that were skipped because
   * the root no longer exists or was read-only.
   */
  async loadProject(name: string): Promise<{ applied: number; skipped: string[] }> {
    await this.ensureStateLoaded()
    const path = this.projectPath(name)
    if (!existsSync(path)) throw new Error(`Project not found: ${name}`)
    const raw = await fs.readFile(path, 'utf8')
    const snap = JSON.parse(raw) as ProjectSnapshot
    let applied = 0
    const skipped: string[] = []
    for (const f of snap.files ?? []) {
      try {
        await this.writeFile(f.rootId, f.subPath, f.content)
        applied += 1
      } catch (err) {
        skipped.push(`${f.rootId}/${f.subPath}: ${(err as Error).message}`)
      }
    }
    return { applied, skipped }
  }

  async deleteProject(name: string): Promise<void> {
    const path = this.projectPath(name)
    if (existsSync(path)) await fs.unlink(path)
  }

  async readProject(name: string): Promise<ProjectSnapshot> {
    const path = this.projectPath(name)
    if (!existsSync(path)) throw new Error(`Project not found: ${name}`)
    const raw = await fs.readFile(path, 'utf8')
    return JSON.parse(raw) as ProjectSnapshot
  }

  async createFolder(rootId: string, subPath: string): Promise<void> {
    const { root, abs } = this.resolveSafe(rootId, subPath)
    if (!root.writable) throw new Error(`UI root "${root.label}" is read-only.`)
    await fs.mkdir(abs, { recursive: true })
  }

  async deleteEntry(rootId: string, subPath: string): Promise<void> {
    const { root, abs } = this.resolveSafe(rootId, subPath)
    if (!root.writable) throw new Error(`UI root "${root.label}" is read-only.`)
    const st = await fs.stat(abs)
    if (st.isDirectory()) await fs.rm(abs, { recursive: true, force: true })
    else await fs.unlink(abs)
  }

  async renameEntry(rootId: string, subPath: string, newName: string): Promise<string> {
    const trimmed = newName.trim()
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\')) {
      throw new Error('Invalid file name')
    }
    const { root, abs } = this.resolveSafe(rootId, subPath)
    if (!root.writable) throw new Error(`UI root "${root.label}" is read-only.`)
    const parent = abs.substring(0, abs.lastIndexOf(sep))
    const target = join(parent, trimmed)
    const rel = relative(root.path, target)
    if (rel.startsWith('..')) throw new Error('Access denied')
    await fs.rename(abs, target)
    return relative(root.path, target).split(sep).join('/')
  }

  /**
   * Return the absolute path for "open in system default editor" or "reveal in
   * file explorer". Validated.
   */
  getAbsolutePath(rootId: string, subPath: string): string {
    return this.resolveSafe(rootId, subPath).abs
  }
}
