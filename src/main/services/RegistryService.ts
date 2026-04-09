import { readFile, writeFile, mkdir, unlink } from 'fs/promises'
import { existsSync, createWriteStream } from 'fs'
import { join, posix } from 'path'
import { createHash } from 'crypto'
import { createGunzip } from 'zlib'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { app, BrowserWindow, session } from 'electron'
import { open as yauzlOpen, type Entry, type ZipFile } from 'yauzl'
import { listEntries as listArchiveEntries } from '../utils/archiveConverter'
import type {
  BeamModMetadata,
  LocalRegistry,
  RegistryRepository,
  AvailableMod,
  InstalledRegistryMod,
  InstallDirective,
  RegistrySearchOptions,
  RegistrySearchResult,
  RegistryStatus,
  ModpackExport
} from '../../shared/registry-types'
import type { ModManagerService } from './ModManagerService'

const REGISTRY_VERSION = 1

const DEFAULT_REPO: RegistryRepository = {
  name: 'official',
  url: 'https://api.github.com/repos/musanajam11/BeamNG-Mod-Registry/releases/latest',
  priority: 0
}

interface RemoteIndex {
  schema_version: number
  generated_at: string
  mod_count: number
  version_count: number
  mods: Record<string, { identifier: string; versions: BeamModMetadata[] }>
}

export class RegistryService {
  private registryPath: string
  private indexPath: string
  private indexGzPath: string
  private cachePath: string
  private registry: LocalRegistry
  private remoteIndex: Map<string, AvailableMod> = new Map()
  private updating = false
  private modManager: ModManagerService | null = null

  constructor() {
    const dataDir = join(app.getPath('appData'), 'BeamMP-ContentManager')
    this.registryPath = join(dataDir, 'registry.json')
    this.cachePath = join(dataDir, 'cache')
    this.indexPath = join(this.cachePath, 'registry-index.json')
    this.indexGzPath = join(this.cachePath, 'registry-index.json.gz')
    this.registry = this.defaultRegistry()
  }

  setModManager(modManager: ModManagerService): void {
    this.modManager = modManager
  }

  private defaultRegistry(): LocalRegistry {
    return {
      registry_version: REGISTRY_VERSION,
      installed: {},
      repositories: [DEFAULT_REPO],
      last_index_update: null
    }
  }

  // ── Lifecycle ──

  async load(): Promise<void> {
    // Load local registry
    try {
      if (existsSync(this.registryPath)) {
        const raw = await readFile(this.registryPath, 'utf-8')
        const parsed = JSON.parse(raw) as LocalRegistry
        if (parsed.registry_version === REGISTRY_VERSION) {
          this.registry = parsed
        }
      }
    } catch (err) {
      console.error('[Registry] Failed to load registry:', err)
    }

    // Load cached remote index if available
    await this.loadCachedIndex()

    // Auto-update if stale (>24h) or never fetched
    const ONE_DAY = 24 * 60 * 60 * 1000
    const lastUpdate = this.registry.last_index_update
    if (!lastUpdate || Date.now() - lastUpdate > ONE_DAY) {
      this.updateIndex().catch((err) =>
        console.error('[Registry] Auto-update failed:', err)
      )
    }
  }

  private async save(): Promise<void> {
    const dir = join(this.registryPath, '..')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf-8')
  }

  // ── Remote Index Management ──

  /**
   * Check for and download the latest index from the configured repository.
   * Uses the GitHub Releases API with ETag-like caching via the release tag.
   */
  async updateIndex(): Promise<{ updated: boolean; error?: string }> {
    if (this.updating) return { updated: false, error: 'Already updating' }
    this.updating = true

    try {
      const repo = this.registry.repositories[0] ?? DEFAULT_REPO

      // 1. Fetch latest release metadata from GitHub API
      const releaseRes = await fetch(repo.url, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'BeamMP-ContentManager/1.0'
        }
      })

      if (!releaseRes.ok) {
        return { updated: false, error: `GitHub API error: ${releaseRes.status}` }
      }

      const release = (await releaseRes.json()) as {
        tag_name: string
        assets: { name: string; browser_download_url: string; size: number }[]
      }

      // 2. Find the gzipped index asset
      const gzAsset = release.assets.find((a) => a.name === 'registry-index.json.gz')
      if (!gzAsset) {
        return { updated: false, error: 'No registry-index.json.gz in latest release' }
      }

      // 3. Download the gz file
      const dlRes = await fetch(gzAsset.browser_download_url, {
        headers: { 'User-Agent': 'BeamMP-ContentManager/1.0' }
      })
      if (!dlRes.ok) {
        return { updated: false, error: `Download failed: ${dlRes.status}` }
      }

      const cacheDir = join(this.indexGzPath, '..')
      if (!existsSync(cacheDir)) {
        await mkdir(cacheDir, { recursive: true })
      }

      // Write gz file to cache
      const arrayBuf = await dlRes.arrayBuffer()
      const buffer = Buffer.from(arrayBuf)
      await writeFile(this.indexGzPath, buffer)

      // 4. Decompress to JSON
      await pipeline(
        Readable.from(buffer),
        createGunzip(),
        createWriteStream(this.indexPath)
      )

      // 5. Load into memory
      await this.loadCachedIndex()

      // 6. Update registry timestamp
      this.registry.last_index_update = Date.now()
      await this.save()

      return { updated: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Registry] Index update failed:', msg)
      return { updated: false, error: msg }
    } finally {
      this.updating = false
    }
  }

  private async loadCachedIndex(): Promise<void> {
    try {
      if (existsSync(this.indexPath)) {
        const raw = await readFile(this.indexPath, 'utf-8')
        const data = JSON.parse(raw) as RemoteIndex
        this.remoteIndex.clear()
        for (const [id, entry] of Object.entries(data.mods)) {
          this.remoteIndex.set(id, {
            identifier: id,
            versions: entry.versions,
            download_count: undefined
          })
        }
      }
    } catch (err) {
      console.error('[Registry] Failed to load cached index:', err)
    }
  }

  // ── Query / Search ──

  /** Search the remote index with filters and pagination */
  search(options: RegistrySearchOptions = {}): RegistrySearchResult {
    let mods = Array.from(this.remoteIndex.values())

    // Text search
    if (options.query) {
      const q = options.query.toLowerCase()
      mods = mods.filter((m) => {
        const latest = m.versions[0]
        if (!latest) return false
        const authors = Array.isArray(latest.author) ? latest.author : [latest.author]
        return (
          latest.name.toLowerCase().includes(q) ||
          latest.abstract.toLowerCase().includes(q) ||
          latest.identifier.toLowerCase().includes(q) ||
          authors.some((a) => a.toLowerCase().includes(q)) ||
          (latest.tags ?? []).some((t) => t.toLowerCase().includes(q))
        )
      })
    }

    // Filter by mod_type
    if (options.mod_type) {
      mods = mods.filter((m) => m.versions[0]?.mod_type === options.mod_type)
    }

    // Filter by tag
    if (options.tag) {
      const tag = options.tag.toLowerCase()
      mods = mods.filter((m) => (m.versions[0]?.tags ?? []).some((t) => t.toLowerCase() === tag))
    }

    // Filter by game version compatibility
    if (options.beamng_version) {
      mods = mods.filter((m) => this.isCompatible(m.versions[0], options.beamng_version!))
    }

    // Sort
    const sortBy = options.sort_by ?? 'name'
    const sortDir = options.sort_order === 'desc' ? -1 : 1
    mods.sort((a, b) => {
      const la = a.versions[0]
      const lb = b.versions[0]
      if (!la || !lb) return 0

      // Verified entries always sort before unverified
      const va = la.x_verified ? 1 : 0
      const vb = lb.x_verified ? 1 : 0
      if (va !== vb) return vb - va

      switch (sortBy) {
        case 'name':
          return la.name.localeCompare(lb.name) * sortDir
        case 'updated':
          return ((lb.release_date ?? '').localeCompare(la.release_date ?? '')) * sortDir
        case 'downloads':
          return ((b.download_count ?? 0) - (a.download_count ?? 0)) * sortDir
        case 'author': {
          const aa = Array.isArray(la.author) ? la.author[0] : la.author
          const ab = Array.isArray(lb.author) ? lb.author[0] : lb.author
          return aa.localeCompare(ab) * sortDir
        }
        default:
          return 0
      }
    })

    // Paginate
    const page = options.page ?? 1
    const perPage = options.per_page ?? 25
    const total = mods.length
    const start = (page - 1) * perPage
    const paged = mods.slice(start, start + perPage)

    return {
      mods: paged,
      total,
      page,
      per_page: perPage,
      total_pages: Math.ceil(total / perPage)
    }
  }

  /** Get a specific mod's full info (all versions) by identifier */
  getMod(identifier: string): AvailableMod | null {
    return this.remoteIndex.get(identifier) ?? null
  }

  /** Get the latest version of a mod that is compatible with the given game version */
  getLatestCompatible(identifier: string, beamngVersion?: string): BeamModMetadata | null {
    const mod = this.remoteIndex.get(identifier)
    if (!mod) return null
    if (!beamngVersion) return mod.versions[0] ?? null
    return mod.versions.find((v) => this.isCompatible(v, beamngVersion)) ?? null
  }

  // ── Game Version Compatibility ──

  private isCompatible(meta: BeamModMetadata | undefined, gameVersion: string): boolean {
    if (!meta) return false
    // "any" or no version constraint = always compatible
    if (meta.beamng_version === 'any' || (!meta.beamng_version && !meta.beamng_version_min && !meta.beamng_version_max)) {
      return true
    }
    if (meta.beamng_version) {
      return gameVersion.startsWith(meta.beamng_version)
    }
    const gv = this.parseVersion(gameVersion)
    if (meta.beamng_version_min) {
      const minV = this.parseVersion(meta.beamng_version_min)
      if (this.compareVersionParts(gv, minV) < 0) return false
    }
    if (meta.beamng_version_max) {
      const maxV = this.parseVersion(meta.beamng_version_max)
      if (this.compareVersionParts(gv, maxV) > 0) return false
    }
    return true
  }

  // ── Installed Mod Tracking ──

  /** Register a mod as installed in the local registry */
  async trackInstall(
    metadata: BeamModMetadata,
    installedFiles: string[],
    source: InstalledRegistryMod['install_source'],
    autoInstalled = false
  ): Promise<void> {
    this.registry.installed[metadata.identifier] = {
      metadata,
      install_time: Date.now(),
      auto_installed: autoInstalled,
      installed_files: installedFiles,
      install_source: source
    }
    await this.save()
  }

  /** Remove a mod from the installed tracking */
  async trackRemoval(identifier: string): Promise<void> {
    delete this.registry.installed[identifier]
    await this.save()
  }

  /** Get all installed mods tracked by the registry */
  getInstalled(): Record<string, InstalledRegistryMod> {
    return this.registry.installed
  }

  /** Check if a mod identifier is installed */
  isInstalled(identifier: string): boolean {
    return identifier in this.registry.installed
  }

  /** Get the installed version of a mod */
  getInstalledVersion(identifier: string): string | null {
    return this.registry.installed[identifier]?.metadata.version ?? null
  }

  /** Find mods that have updates available */
  getUpdatesAvailable(): Array<{ identifier: string; installed: string; latest: string; mod: BeamModMetadata }> {
    const updates: Array<{ identifier: string; installed: string; latest: string; mod: BeamModMetadata }> = []
    for (const [id, entry] of Object.entries(this.registry.installed)) {
      const remote = this.remoteIndex.get(id)
      if (!remote || remote.versions.length === 0) continue
      const latest = remote.versions[0]
      if (this.compareVersions(latest.version, entry.metadata.version) > 0) {
        updates.push({
          identifier: id,
          installed: entry.metadata.version,
          latest: latest.version,
          mod: latest
        })
      }
    }
    return updates
  }

  // ── Status ──

  getStatus(): RegistryStatus {
    return {
      has_index: this.remoteIndex.size > 0,
      last_updated: this.registry.last_index_update,
      available_count: this.remoteIndex.size,
      installed_count: Object.keys(this.registry.installed).length,
      updating: this.updating
    }
  }

  // ── Repository Configuration ──

  getRepositories(): RegistryRepository[] {
    return this.registry.repositories
  }

  async setRepositories(repos: RegistryRepository[]): Promise<void> {
    this.registry.repositories = repos
    await this.save()
  }

  // ── Modpack Export / Import ──

  exportModpack(name: string): ModpackExport {
    const mods: ModpackExport['mods'] = []
    for (const [id, entry] of Object.entries(this.registry.installed)) {
      mods.push({
        identifier: id,
        version: entry.metadata.version,
        auto_installed: entry.auto_installed
      })
    }
    return {
      format_version: 1,
      name,
      exported_at: new Date().toISOString(),
      mods
    }
  }

  importModpack(modpack: ModpackExport): { identifiers: string[]; missing: string[] } {
    const identifiers: string[] = []
    const missing: string[] = []
    for (const entry of modpack.mods) {
      if (entry.auto_installed) continue // skip auto-deps, they'll be resolved
      const available = this.remoteIndex.get(entry.identifier)
      if (available) {
        identifiers.push(entry.identifier)
      } else {
        missing.push(entry.identifier)
      }
    }
    return { identifiers, missing }
  }

  // ── Version Comparison (Debian-style, like CKAN) ──

  compareVersions(a: string, b: string): number {
    const pa = this.parseEpochVersion(a)
    const pb = this.parseEpochVersion(b)
    if (pa.epoch !== pb.epoch) return pa.epoch - pb.epoch
    return this.compareVersionParts(
      this.parseVersion(pa.version),
      this.parseVersion(pb.version)
    )
  }

  private parseEpochVersion(v: string): { epoch: number; version: string } {
    const colonIdx = v.indexOf(':')
    if (colonIdx > 0) {
      const epoch = parseInt(v.slice(0, colonIdx), 10)
      return { epoch: isNaN(epoch) ? 0 : epoch, version: v.slice(colonIdx + 1) }
    }
    return { epoch: 0, version: v }
  }

  private parseVersion(v: string): number[] {
    return v.split(/[.\-+_]/).map((p) => {
      const n = parseInt(p, 10)
      return isNaN(n) ? 0 : n
    })
  }

  private compareVersionParts(a: number[], b: number[]): number {
    const len = Math.max(a.length, b.length)
    for (let i = 0; i < len; i++) {
      const av = a[i] ?? 0
      const bv = b[i] ?? 0
      if (av !== bv) return av - bv
    }
    return 0
  }

  // ── Helpers for DependencyResolver ──

  /** Get all available mod identifiers (including virtual "provides") */
  getAllProviders(identifier: string): BeamModMetadata[] {
    // Direct match
    const direct = this.remoteIndex.get(identifier)
    if (direct) return direct.versions

    // Check "provides" across all mods
    const providers: BeamModMetadata[] = []
    for (const mod of this.remoteIndex.values()) {
      for (const ver of mod.versions) {
        if (ver.provides?.includes(identifier)) {
          providers.push(ver)
        }
      }
    }
    return providers
  }

  // ── Install Orchestrator ──

  async installFromRegistry(
    metadata: BeamModMetadata,
    userDir: string,
    autoInstalled = false,
    serverDir?: string
  ): Promise<{ success: boolean; installedFiles: string[]; error?: string }> {
    // Metapackages have no download — just track install
    if (metadata.kind === 'metapackage') {
      await this.trackInstall(metadata, [], 'registry', autoInstalled)
      return { success: true, installedFiles: [] }
    }

    const downloadUrl = Array.isArray(metadata.download) ? metadata.download[0] : metadata.download
    if (!downloadUrl) {
      return { success: false, installedFiles: [], error: 'No download URL in metadata' }
    }

    const installedFiles: string[] = []

    try {
      // 1. Download the archive to a temp file
      const tempPath = join(this.cachePath, `${metadata.identifier}-${metadata.version}.zip`)
      if (!existsSync(this.cachePath)) {
        await mkdir(this.cachePath, { recursive: true })
      }

      // Send download progress events to renderer
      const sendProgress = (received: number, total: number): void => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('registry:downloadProgress', {
            identifier: metadata.identifier,
            received,
            total,
            fileName: `${metadata.identifier}-${metadata.version}.zip`
          })
        }
      }

      // Use BeamNG.com session cookies when downloading from beamng.com
      const headers: Record<string, string> = { 'User-Agent': 'BeamMP-ContentManager/1.0' }
      if (downloadUrl.includes('beamng.com')) {
        try {
          const beamngSession = session.fromPartition('persist:beamng')
          const cookies = await beamngSession.cookies.get({ url: 'https://www.beamng.com' })
          const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
          if (cookieStr) headers['Cookie'] = cookieStr
        } catch { /* no beamng session available */ }
      }

      const dlRes = await fetch(downloadUrl, { headers })
      if (!dlRes.ok) {
        if (dlRes.status === 403 && downloadUrl.includes('beamng.com')) {
          return { success: false, installedFiles: [], error: 'BeamNG.com login required. Log in via the Browse tab first.' }
        }
        return { success: false, installedFiles: [], error: `Download failed: ${dlRes.status}` }
      }

      const contentLength = parseInt(dlRes.headers.get('content-length') ?? '0', 10)
      const body = dlRes.body
      let buffer: Buffer

      if (body && contentLength > 0) {
        // Stream download with progress
        const chunks: Buffer[] = []
        let received = 0
        const reader = body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = Buffer.from(value)
          chunks.push(chunk)
          received += chunk.length
          sendProgress(received, contentLength)
        }
        buffer = Buffer.concat(chunks)
      } else {
        const arrayBuf = await dlRes.arrayBuffer()
        buffer = Buffer.from(arrayBuf)
        sendProgress(buffer.length, buffer.length)
      }

      // 2. Verify SHA256 hash
      if (metadata.download_hash?.sha256) {
        const hash = createHash('sha256').update(buffer).digest('hex')
        if (hash.toLowerCase() !== metadata.download_hash.sha256.toLowerCase()) {
          return {
            success: false,
            installedFiles: [],
            error: `SHA256 mismatch: expected ${metadata.download_hash.sha256}, got ${hash}`
          }
        }
      }

      await writeFile(tempPath, buffer)

      // 3. Process install based on multiplayer_scope
      const scope = metadata.multiplayer_scope ?? 'client'
      const directives = metadata.install

      if (scope === 'client') {
        // Standard client mod → mods/repo/
        if (!directives || directives.length === 0) {
          if (!this.modManager) {
            return { success: false, installedFiles: [], error: 'ModManager not initialized' }
          }
          const modInfo = await this.modManager.installMod(userDir, tempPath)
          installedFiles.push(modInfo.filePath)
        } else {
          for (const directive of directives) {
            const files = await this.processInstallDirective(directive, tempPath, userDir)
            installedFiles.push(...files)
          }
        }
      } else if (scope === 'server') {
        // Server plugin only → Resources/Server/<identifier>/
        if (!serverDir) {
          return { success: false, installedFiles: [], error: 'Server directory required for server-scope mods' }
        }
        const serverResDir = join(serverDir, 'Resources', 'Server', metadata.identifier)
        const files = await this.extractToDirectory(tempPath, serverResDir)
        installedFiles.push(...files)
      } else if (scope === 'both') {
        // Has both client and server components — two strategies:
        // Strategy 1: Outer-zip layout (Resources/Client/*.zip + Resources/Server/*/)
        // Strategy 2: Dual-component (separate server_download)

        const entries = await this.listZipEntries(tempPath)
        const hasResourcesLayout = entries.some(
          (e) => e.startsWith('Resources/Client/') || e.startsWith('Resources/Server/')
        )

        if (hasResourcesLayout) {
          // Outer-zip aware: extract client zips to mods/repo, server files to Resources/Server/
          await this.installResourcesLayout(tempPath, entries, userDir, serverDir, installedFiles, metadata.identifier)
        } else if (metadata.server_download) {
          // Dual-component: main download is client mod, server_download is server plugin
          // Install client mod
          if (!directives || directives.length === 0) {
            if (!this.modManager) {
              return { success: false, installedFiles: [], error: 'ModManager not initialized' }
            }
            const modInfo = await this.modManager.installMod(userDir, tempPath)
            installedFiles.push(modInfo.filePath)
          } else {
            for (const directive of directives) {
              const files = await this.processInstallDirective(directive, tempPath, userDir)
              installedFiles.push(...files)
            }
          }

          // Download and install server plugin
          if (serverDir) {
            const serverFiles = await this.downloadAndInstallServerPlugin(
              metadata, serverDir, sendProgress
            )
            installedFiles.push(...serverFiles)
          }
        } else {
          // Fallback: treat as client-only (no server component available)
          if (!directives || directives.length === 0) {
            if (!this.modManager) {
              return { success: false, installedFiles: [], error: 'ModManager not initialized' }
            }
            const modInfo = await this.modManager.installMod(userDir, tempPath)
            installedFiles.push(modInfo.filePath)
          } else {
            for (const directive of directives) {
              const files = await this.processInstallDirective(directive, tempPath, userDir)
              installedFiles.push(...files)
            }
          }
        }
      }

      // 4. Clean up temp file
      try { await unlink(tempPath) } catch { /* ignore */ }

      // 5. Track the installation
      await this.trackInstall(metadata, installedFiles, 'registry', autoInstalled)

      return { success: true, installedFiles }
    } catch (err) {
      // Transactional rollback: clean up any files we already wrote
      for (const f of installedFiles) {
        try { await unlink(f) } catch { /* ignore */ }
      }

      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[Registry] Install failed for ${metadata.identifier}:`, msg)
      return { success: false, installedFiles: [], error: msg }
    }
  }

  private async processInstallDirective(
    directive: InstallDirective,
    zipPath: string,
    userDir: string
  ): Promise<string[]> {
    const targetDir = this.resolveInstallTo(directive.install_to, userDir)
    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true })
    }

    // Build filter (exclude) sets
    const filterNames = new Set<string>()
    if (directive.filter) {
      const filters = Array.isArray(directive.filter) ? directive.filter : [directive.filter]
      for (const f of filters) filterNames.add(f.toLowerCase())
    }
    const filterRegexps: RegExp[] = []
    if (directive.filter_regexp) {
      const patterns = Array.isArray(directive.filter_regexp) ? directive.filter_regexp : [directive.filter_regexp]
      for (const p of patterns) filterRegexps.push(new RegExp(p))
    }

    // Build include_only (whitelist) sets
    const includeOnlyNames = new Set<string>()
    if (directive.include_only) {
      const includes = Array.isArray(directive.include_only) ? directive.include_only : [directive.include_only]
      for (const f of includes) includeOnlyNames.add(f.toLowerCase())
    }
    const includeOnlyRegexps: RegExp[] = []
    if (directive.include_only_regexp) {
      const patterns = Array.isArray(directive.include_only_regexp) ? directive.include_only_regexp : [directive.include_only_regexp]
      for (const p of patterns) includeOnlyRegexps.push(new RegExp(p))
    }
    const hasIncludeOnly = includeOnlyNames.size > 0 || includeOnlyRegexps.length > 0

    // Find matching entries in zip
    const entries = await this.listZipEntries(zipPath)
    const matchedBase = this.findMatchBase(entries, directive)
    if (matchedBase === null) {
      console.warn(`[Registry] No match for directive in ${zipPath}:`, directive)
      return []
    }

    const installed: string[] = []
    const zipFile = await this.openZipFile(zipPath)
    try {
      for (const entry of entries) {
        // Only entries under the matched base
        if (!entry.startsWith(matchedBase)) continue
        // Skip directories
        if (entry.endsWith('/')) continue

        const relativePath = entry.slice(matchedBase.length)
        if (!relativePath) continue

        // Apply filters (exclude)
        const fileName = posix.basename(relativePath)
        if (filterNames.has(fileName.toLowerCase())) continue
        if (filterRegexps.some((r) => r.test(relativePath))) continue

        // Apply include_only (whitelist) — if set, only include matching files
        if (hasIncludeOnly) {
          const matchedByName = includeOnlyNames.has(fileName.toLowerCase())
          const matchedByRegex = includeOnlyRegexps.some((r) => r.test(relativePath))
          if (!matchedByName && !matchedByRegex) continue
        }

        // Determine output path
        let outputPath: string
        if (directive.as) {
          // "as" renames the root directory/file
          const parts = relativePath.split('/')
          if (parts.length <= 1) {
            outputPath = join(targetDir, directive.as)
          } else {
            outputPath = join(targetDir, directive.as, ...parts.slice(1))
          }
        } else {
          outputPath = join(targetDir, ...relativePath.split('/'))
        }

        // Extract file
        const outputDir = join(outputPath, '..')
        if (!existsSync(outputDir)) {
          await mkdir(outputDir, { recursive: true })
        }

        const data = await this.readZipEntry(zipFile, entry)
        await writeFile(outputPath, data)
        installed.push(outputPath)
      }
    } finally {
      zipFile.close()
    }

    return installed
  }

  private resolveInstallTo(installTo: string, userDir: string): string {
    // Map logical names to actual paths
    switch (installTo) {
      case 'mods':
      case 'mods/':
        return join(userDir, 'mods', 'repo')
      case 'mods/repo':
      case 'mods/repo/':
        return join(userDir, 'mods', 'repo')
      default:
        // Treat as relative to userDir
        return join(userDir, installTo)
    }
  }

  /**
   * Handle a Resources-layout outer zip (e.g. BeamRadio):
   *   Resources/Client/*.zip → extract inner zips to mods/repo/
   *   Resources/Server/<name>/* → extract to server's Resources/Server/<name>/
   */
  private async installResourcesLayout(
    outerZipPath: string,
    entries: string[],
    userDir: string,
    serverDir: string | undefined,
    installedFiles: string[],
    identifier: string
  ): Promise<void> {
    const zipFile = await this.openZipFile(outerZipPath)
    try {
      // Extract client zips from Resources/Client/
      const clientZips = entries.filter(
        (e) => e.startsWith('Resources/Client/') && e.endsWith('.zip') && !e.endsWith('/')
      )
      for (const entry of clientZips) {
        const data = await this.readZipEntry(zipFile, entry)
        const destPath = join(userDir, 'mods', 'repo', posix.basename(entry))
        const destDir = join(userDir, 'mods', 'repo')
        if (!existsSync(destDir)) await mkdir(destDir, { recursive: true })
        await writeFile(destPath, data)
        installedFiles.push(destPath)
      }

      // Extract server files from Resources/Server/ to the managed server
      if (serverDir) {
        const serverEntries = entries.filter(
          (e) => e.startsWith('Resources/Server/') && !e.endsWith('/') && e.length > 'Resources/Server/'.length
        )
        for (const entry of serverEntries) {
          const relativePath = entry.slice('Resources/'.length) // Keep Server/<name>/file
          const destPath = join(serverDir, 'Resources', relativePath)
          const destDir = join(destPath, '..')
          if (!existsSync(destDir)) await mkdir(destDir, { recursive: true })
          const data = await this.readZipEntry(zipFile, entry)
          await writeFile(destPath, data)
          installedFiles.push(destPath)
        }
      } else {
        console.warn(`[Registry] ${identifier}: has server components but no target server specified — skipping server plugin install`)
      }
    } finally {
      zipFile.close()
    }
  }

  /**
   * Download a mod's archive and install only the server component to a target server.
   * Used by the ModsPanel "Copy to Server" flow for mods with multiplayer_scope: "both".
   */
  async installServerComponentToServer(
    metadata: BeamModMetadata,
    serverDir: string
  ): Promise<string[]> {
    const url = Array.isArray(metadata.download) ? metadata.download[0] : metadata.download
    if (!url) return []

    const dlRes = await fetch(url, {
      headers: { 'User-Agent': 'BeamMP-ContentManager/1.0' }
    })
    if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`)

    const buffer = Buffer.from(await dlRes.arrayBuffer())
    const tempPath = join(this.cachePath, `server-component-${metadata.identifier}-${Date.now()}.zip`)
    await writeFile(tempPath, buffer)

    try {
      return await this.extractServerComponentFromZip(tempPath, serverDir)
    } finally {
      try { await unlink(tempPath) } catch { /* ignore */ }
    }
  }

  /**
   * Extract Resources/Client/*.zip entries from a Resources-layout outer zip to a target directory.
   * Returns the paths of the extracted client zips, or empty array if no Resources/Client/ layout.
   */
  async extractClientZipsFromOuterZip(
    zipPath: string,
    destDir: string
  ): Promise<string[]> {
    const entries = await this.listZipEntries(zipPath)
    const clientZips = entries.filter(
      (e) => e.startsWith('Resources/Client/') && e.endsWith('.zip') && !e.endsWith('/')
    )
    if (clientZips.length === 0) return []

    const zipFile = await this.openZipFile(zipPath)
    const extracted: string[] = []
    try {
      if (!existsSync(destDir)) await mkdir(destDir, { recursive: true })
      for (const entry of clientZips) {
        const data = await this.readZipEntry(zipFile, entry)
        const destPath = join(destDir, posix.basename(entry))
        await writeFile(destPath, data)
        extracted.push(destPath)
      }
    } finally {
      zipFile.close()
    }
    return extracted
  }

  /**
   * Extract Resources/Server/* entries from a local zip file to a target server directory.
   * Used for both registry mods and manually imported client+server mods.
   */
  async extractServerComponentFromZip(
    zipPath: string,
    serverDir: string
  ): Promise<string[]> {
    const entries = await this.listZipEntries(zipPath)
    const serverEntries = entries.filter(
      (e) => e.startsWith('Resources/Server/') && !e.endsWith('/') && e.length > 'Resources/Server/'.length
    )

    if (serverEntries.length === 0) return []

    const zipFile = await this.openZipFile(zipPath)
    const installedFiles: string[] = []
    try {
      for (const entry of serverEntries) {
        const relativePath = entry.slice('Resources/'.length)
        const destPath = join(serverDir, 'Resources', relativePath)
        const destDir = join(destPath, '..')
        if (!existsSync(destDir)) await mkdir(destDir, { recursive: true })
        const data = await this.readZipEntry(zipFile, entry)
        await writeFile(destPath, data)
        installedFiles.push(destPath)
      }
    } finally {
      zipFile.close()
    }
    return installedFiles
  }

  /**
   * Download and install a separate server plugin archive (dual-component model).
   * Extracts contents to the server's Resources/Server/<identifier>/.
   */
  private async downloadAndInstallServerPlugin(
    metadata: BeamModMetadata,
    serverDir: string,
    sendProgress: (received: number, total: number) => void
  ): Promise<string[]> {
    const serverUrl = Array.isArray(metadata.server_download)
      ? metadata.server_download[0]
      : metadata.server_download
    if (!serverUrl) return []

    const dlRes = await fetch(serverUrl, {
      headers: { 'User-Agent': 'BeamMP-ContentManager/1.0' }
    })
    if (!dlRes.ok) {
      throw new Error(`Server plugin download failed: ${dlRes.status}`)
    }

    const contentLength = parseInt(dlRes.headers.get('content-length') ?? '0', 10)
    const body = dlRes.body
    let buffer: Buffer

    if (body && contentLength > 0) {
      const chunks: Buffer[] = []
      let received = 0
      const reader = body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        chunks.push(chunk)
        received += chunk.length
        sendProgress(received, contentLength)
      }
      buffer = Buffer.concat(chunks)
    } else {
      const arrayBuf = await dlRes.arrayBuffer()
      buffer = Buffer.from(arrayBuf)
      sendProgress(buffer.length, buffer.length)
    }

    // Verify SHA256 hash
    if (metadata.server_download_hash?.sha256) {
      const hash = createHash('sha256').update(buffer).digest('hex')
      if (hash.toLowerCase() !== metadata.server_download_hash.sha256.toLowerCase()) {
        throw new Error(
          `Server plugin SHA256 mismatch: expected ${metadata.server_download_hash.sha256}, got ${hash}`
        )
      }
    }

    // Write to temp and extract
    const tempPath = join(this.cachePath, `${metadata.identifier}-server-${metadata.version}.zip`)
    await writeFile(tempPath, buffer)
    const serverResDir = join(serverDir, 'Resources', 'Server', metadata.identifier)
    const files = await this.extractToDirectory(tempPath, serverResDir)
    try { await unlink(tempPath) } catch { /* ignore */ }
    return files
  }

  /**
   * Extract all files from a zip into a target directory, preserving relative paths.
   */
  private async extractToDirectory(zipPath: string, targetDir: string): Promise<string[]> {
    if (!existsSync(targetDir)) await mkdir(targetDir, { recursive: true })
    const entries = await this.listZipEntries(zipPath)
    const zipFile = await this.openZipFile(zipPath)
    const installed: string[] = []
    try {
      for (const entry of entries) {
        if (entry.endsWith('/')) continue
        const destPath = join(targetDir, ...entry.split('/'))
        const destDir = join(destPath, '..')
        if (!existsSync(destDir)) await mkdir(destDir, { recursive: true })
        const data = await this.readZipEntry(zipFile, entry)
        await writeFile(destPath, data)
        installed.push(destPath)
      }
    } finally {
      zipFile.close()
    }
    return installed
  }

  private findMatchBase(entries: string[], directive: InstallDirective): string | null {
    if (directive.file !== undefined) {
      // Exact path match
      const target = directive.file.replace(/\\/g, '/')
      // Check if it's a directory prefix or an exact file
      const dirTarget = target.endsWith('/') ? target : target + '/'
      if (entries.some((e) => e === target || e.startsWith(dirTarget))) {
        return dirTarget
      }
      // Exact file match → base is its parent
      if (entries.includes(target)) {
        const lastSlash = target.lastIndexOf('/')
        return lastSlash >= 0 ? target.slice(0, lastSlash + 1) : ''
      }
      return null
    }

    if (directive.find) {
      const needle = directive.find.toLowerCase()

      // Search directories first
      for (const entry of entries) {
        if (!entry.endsWith('/')) continue
        const parts = entry.slice(0, -1).split('/')
        const dirName = parts[parts.length - 1]
        if (dirName.toLowerCase() === needle) {
          return entry
        }
      }

      // If find_matches_files is enabled, also match individual files
      if (directive.find_matches_files) {
        for (const entry of entries) {
          if (entry.endsWith('/')) continue
          const fileName = posix.basename(entry)
          if (fileName.toLowerCase() === needle) {
            const lastSlash = entry.lastIndexOf('/')
            return lastSlash >= 0 ? entry.slice(0, lastSlash + 1) : ''
          }
        }
      }

      return null
    }

    if (directive.find_regexp) {
      const re = new RegExp(directive.find_regexp)

      // Search directories first
      for (const entry of entries) {
        if (!entry.endsWith('/')) continue
        if (re.test(entry)) return entry
      }

      // If find_matches_files is enabled, also match individual files
      if (directive.find_matches_files) {
        for (const entry of entries) {
          if (entry.endsWith('/')) continue
          if (re.test(entry)) {
            const lastSlash = entry.lastIndexOf('/')
            return lastSlash >= 0 ? entry.slice(0, lastSlash + 1) : ''
          }
        }
      } else {
        // Legacy behavior: also check files as fallback
        for (const entry of entries) {
          if (re.test(entry)) {
            const lastSlash = entry.lastIndexOf('/')
            return lastSlash >= 0 ? entry.slice(0, lastSlash + 1) : ''
          }
        }
      }

      return null
    }

    // No match criteria—install everything from root
    return ''
  }

  private listZipEntries(zipPath: string): Promise<string[]> {
    return listArchiveEntries(zipPath)
  }

  private openZipFile(zipPath: string): Promise<ZipFile> {
    return new Promise((resolve, reject) => {
      yauzlOpen(zipPath, { lazyEntries: true }, (err, zf) => {
        if (err || !zf) { reject(err || new Error('Failed to open zip')); return }
        resolve(zf)
      })
    })
  }

  private readZipEntry(zf: ZipFile, fileName: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const onEntry = (entry: Entry): void => {
        if (entry.fileName === fileName) {
          zf.openReadStream(entry, (err, stream) => {
            if (err || !stream) { reject(err || new Error('No stream')); return }
            const chunks: Buffer[] = []
            stream.on('data', (chunk: Buffer) => chunks.push(chunk))
            stream.on('end', () => resolve(Buffer.concat(chunks)))
            stream.on('error', reject)
          })
        } else {
          zf.readEntry()
        }
      }
      zf.on('entry', onEntry)
      zf.on('end', () => reject(new Error(`Entry not found: ${fileName}`)))
      zf.readEntry()
    })
  }
}
