import { get as httpsGet } from 'https'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, readFile, writeFile, rm, copyFile, readdir, rmdir } from 'node:fs/promises'
import { join, dirname, basename, resolve as resolvePath, sep } from 'node:path'
import { app } from 'electron'
import { open as yauzlOpen, type Entry } from 'yauzl'

/* ── Compatibility tags ── */
export type PluginCompat = 'careerMP' | 'rls' | 'both' | 'beamMP'

/**
 * Install methods supported for plugins:
 * - extract-to-root: Zip already contains a `Resources/` folder at root → extract to server root.
 * - extract-to-server-plugin: Zip contains loose plugin files (lua/, scripts/, ...) → extract into
 *   `Resources/Server/<pluginFolder>/`.
 * - copy-client-zip: Zip is a self-contained client mod → copy zip into `Resources/Client/`.
 */
export type PluginInstallMethod = 'extract-to-root' | 'extract-to-server-plugin' | 'copy-client-zip'

export interface PluginCatalogEntry {
  /** Stable internal id, used as key in tracking metadata. */
  id: string
  name: string
  description: string
  author: string
  /** GitHub `owner/repo`. Optional when `source === 'beamng'`. */
  repo?: string
  homepage: string
  compat: PluginCompat
  installMethod: PluginInstallMethod
  /**
   * For `extract-to-server-plugin`: name of the folder created under Resources/Server/.
   * For `extract-to-root`: list of top-level paths the zip is expected to write under
   * Resources/ (used for tracking & uninstall).
   * For `copy-client-zip`: not used (the downloaded zip's filename is tracked instead).
   */
  serverPluginFolder?: string
  /**
   * Optional path inside the repository tag source zip to extract into
   * `Resources/Server/<serverPluginFolder>/`.
   * Example: `Resources/Server/MyPlugin`.
   */
  serverSourceFromTagSubdir?: string
  /**
   * Optional path to the actual client mod zip inside a wrapper archive.
   * Example: `Resources/Client/busDisplaySync.zip`.
   */
  clientZipPathInArchive?: string
  /**
   * Mod source. Defaults to GitHub releases. `beamng` entries are downloaded from
   * BeamNG.com using the same logged-in cookie session as the main mod browser,
   * then deployed straight to `Resources/Client/` of the selected hosted server.
   */
  source?: 'github' | 'beamng'
  /** BeamNG.com resource metadata, required when `source === 'beamng'`. */
  beamngResource?: {
    resourceId: number
    slug: string
    /** Display version label (BeamNG.com doesn't give us a real release feed via this flow). */
    version: string
    /** Optional changelog/notes text shown in the version row. */
    notes?: string
  }
}

/* ── Static catalog ── */
export const PLUGIN_CATALOG: PluginCatalogEntry[] = [
  {
    id: 'careermp-banking',
    name: 'CareerMP Banking',
    description: 'A custom BeamNG UI app for CareerMP that provides a cleaner banking interface for player payments. Uses CareerMP\'s payment backend for money movement, transaction limits, and balance changes.',
    author: 'DeadEndReece',
    repo: 'DeadEndReece/CareerMP-Banking',
    homepage: 'https://github.com/DeadEndReece/CareerMP-Banking',
    compat: 'careerMP',
    installMethod: 'extract-to-root',
    serverPluginFolder: 'CareerMPBanking'
  },
  {
    id: 'buber',
    name: 'Buber',
    description: 'BUBER turns BeamNG.drive Career Mode into a ride-share, taxi, shared ride, and bus route side hustle. Take fares, keep passengers happy, build your driver rating, unlock bigger jobs, and work your way from small local pickups to full city routes.',
    author: 'DeadEndReece',
    repo: 'DeadEndReece/Buber',
    homepage: 'https://github.com/DeadEndReece/Buber',
    compat: 'careerMP',
    installMethod: 'extract-to-server-plugin',
    serverPluginFolder: 'Buber'
  },
  {
    id: 'dynamic-traffic',
    name: 'BeamMP Dynamic Traffic',
    description: 'A dynamic server and client module for BeamMP that intelligently manages AI traffic spawning based on active player counts. Features a waiting room mechanism to prevent traffic from generating before players have fully loaded into the server.',
    author: 'DeadEndReece',
    repo: 'DeadEndReece/BeamMPDynamicTraffic',
    homepage: 'https://github.com/DeadEndReece/BeamMPDynamicTraffic',
    compat: 'both',
    installMethod: 'extract-to-root',
    serverPluginFolder: 'CareerMPTraffic'
  },
  {
    id: 'citybus-displays-sync',
    name: 'citybusDisplaysSync',
    description: 'Fixes display bugs in BeamNG\'s citybus displays and busline UI app, and syncs bus displays across all players in BeamMP. Works great with CareerMP and Buber for bus route gameplay, as well as freeRoamMP.',
    author: 'StanleyDudek',
    repo: 'StanleyDudek/citybusDisplaysSync',
    homepage: 'https://github.com/StanleyDudek/citybusDisplaysSync',
    compat: 'careerMP',
    installMethod: 'copy-client-zip',
    clientZipPathInArchive: 'Resources/Client/busDisplaySync.zip'
  },
  {
    id: 'player-dealership-loaner',
    name: 'Player Dealership + Loaner System',
    description: 'Adds a player-run vehicle marketplace, timed temporary keys / loaners, party creation, and party-only shared vehicle visibility to CareerMP servers. Includes a dedicated in-game UI with Party, Dealership, and Loaners tabs. Works great with RLS + CareerMP.',
    author: 'ChiarelloB',
    repo: 'ChiarelloB/Player-Dealership-Loaner-System-for-CareerMP',
    homepage: 'https://github.com/ChiarelloB/Player-Dealership-Loaner-System-for-CareerMP',
    compat: 'both',
    installMethod: 'copy-client-zip',
    serverSourceFromTagSubdir: 'Resources/Server/CareerMPPartySharedVehicles',
    serverPluginFolder: 'CareerMPPartySharedVehicles'
  },
  {
    id: 'node-based-tire-wear',
    name: 'Experimental Node Based Tire Wear',
    description: 'Adds tire thermals and node based tire wear. Friction, wear, and mass are simulated for each node on the tire allowing for dynamic behaviors such as flatspots and natural camber wear.',
    author: 'Jesus Goose',
    homepage: 'https://www.beamng.com/resources/node-based-tire-wear.36502/',
    compat: 'both',
    installMethod: 'copy-client-zip',
    source: 'beamng',
    beamngResource: {
      resourceId: 36502,
      slug: 'node-based-tire-wear',
      version: '2.61',
      notes: 'Always installs the latest version published on BeamNG.com.'
    }
  },
  {
    id: 'individual-part-repair-menu',
    name: 'Individual Part Repair Menu',
    description: 'Allows for the repair of individual parts. Adds a new UI app called "Individual Part Repair Menu" that can be used to select individual parts for repair. It also introduces a custom beamstate save/load system that saves damage per vehicle configuration, allowing damage states to persist across maps and sessions.',
    author: 'Jesus Goose',
    homepage: 'https://www.beamng.com/resources/individual-part-repair-menu.35878/',
    compat: 'both',
    installMethod: 'copy-client-zip',
    source: 'beamng',
    beamngResource: {
      resourceId: 35878,
      slug: 'individual-part-repair-menu',
      version: '3.71',
      notes: 'Always installs the latest version published on BeamNG.com.'
    }
  }
]

/* ── Server Admin Tools catalog (BeamMP/CobaltEssentials ecosystem) ── */
export const SERVER_ADMIN_CATALOG: PluginCatalogEntry[] = [
  {
    id: 'cobalt-essentials',
    name: 'CobaltEssentials',
    description: 'CobaltEssentials for BeamMP Servers. Provides admin and permissions management with group-based access control.',
    author: 'prestonelam2003',
    repo: 'prestonelam2003/CobaltEssentials',
    homepage: 'https://github.com/prestonelam2003/CobaltEssentials',
    compat: 'beamMP',
    // Release zip already contains `Resources/Server/CobaltEssentials/...` at its root,
    // so we extract to the server root rather than nesting under Resources/Server/CobaltEssentials/.
    installMethod: 'extract-to-root',
    serverPluginFolder: 'CobaltEssentials'
  },
  {
    id: 'cobalt-essentials-interface',
    name: 'CobaltEssentialsInterface (CEI)',
    description: 'A Dear ImGui based interface for BeamMP Servers running CobaltEssentials.',
    author: 'Dudekahedron',
    repo: 'StanleyDudek/CobaltEssentialsInterface',
    homepage: 'https://github.com/StanleyDudek/CobaltEssentialsInterface',
    compat: 'beamMP',
    installMethod: 'extract-to-root',
    serverPluginFolder: 'CobaltEssentialsInterface'
  },
  {
    id: 'restart-notifier',
    name: 'Restart Notifier',
    description: 'A BeamMP plugin to notify players of scheduled server restarts with customizable warnings and manual trigger options.',
    author: 'DeadEndReece',
    repo: 'DeadEndReece/RestartNotifier',
    homepage: 'https://github.com/DeadEndReece/RestartNotifier',
    compat: 'beamMP',
    installMethod: 'extract-to-root',
    serverPluginFolder: 'RestartNotifier'
  },
  {
    id: 'profilter',
    name: 'ProFilter',
    description: 'A highly customizable, server-side profanity filter for BeamMP. Intercepts chat messages before they are broadcasted to the server, actively preventing toxicity while giving server owners complete control over how rule-breakers are handled.',
    author: 'DeadEndReece',
    repo: 'DeadEndReece/ProFilter',
    homepage: 'https://github.com/DeadEndReece/ProFilter',
    compat: 'beamMP',
    installMethod: 'extract-to-root',
    serverPluginFolder: 'ProFilter'
  },
  {
    id: 'beammp-quick-chat',
    name: 'BeamMP Quick Chat',
    description: 'A highly customizable quality-of-life UI app for BeamMP players. Create, organize, and send predefined chat messages and server commands with a single click — perfect for rapid communication during races, cruises, or roleplay sessions.',
    author: 'DeadEndReece',
    repo: 'DeadEndReece/BeamMP-Quick-Chat',
    homepage: 'https://github.com/DeadEndReece/BeamMP-Quick-Chat',
    compat: 'beamMP',
    installMethod: 'copy-client-zip'
  }
]

export type PluginCategory = 'career' | 'admin'

/* ── Types ── */
export interface PluginRelease {
  version: string
  name: string
  changelog: string
  prerelease: boolean
  publishedAt: string
  downloadUrl: string
  size: number
  downloads: number
}

export interface InstalledPlugin {
  pluginId: string
  version: string
  installedAt: string
  /** Files/folders created during install (relative to serverDir), used for uninstall. */
  artifacts: string[]
}

interface InstalledPluginsFile {
  plugins: Record<string, InstalledPlugin>
}

const CAREER_TRACKING_FILE = 'career-plugins.json'
const ADMIN_TRACKING_FILE = 'server-admin-plugins.json'

function catalogFor(category: PluginCategory): PluginCatalogEntry[] {
  const base = category === 'admin' ? SERVER_ADMIN_CATALOG : PLUGIN_CATALOG
  // Great Rebalance compatibility patch is managed by the dedicated GR flow,
  // not by the generic plugin browser.
  return base.filter((p) => p.id !== 'rls-careermp-compat-patch')
}

function trackingFileFor(category: PluginCategory): string {
  return category === 'admin' ? ADMIN_TRACKING_FILE : CAREER_TRACKING_FILE
}

/* ── Service ── */

export class CareerPluginService {
  private tmpDir: string

  constructor() {
    this.tmpDir = join(app.getPath('temp'), 'beamcm-career-plugins')
  }

  listCatalog(category: PluginCategory = 'career'): PluginCatalogEntry[] {
    return catalogFor(category)
  }

  async fetchPluginReleases(pluginId: string, category: PluginCategory = 'career'): Promise<PluginRelease[]> {
    const entry = this.requireEntry(pluginId, category)
    // BeamNG.com sourced plugins don't expose a release feed; we synthesise a single
    // "latest" release whose downloadUrl is a sentinel `beamng://<resourceId>/<slug>`
    // that the IPC layer recognises and routes through the cookie-authenticated
    // BeamNG.com download flow.
    if (entry.source === 'beamng' && entry.beamngResource) {
      const r = entry.beamngResource
      return [{
        version: r.version,
        name: `${entry.name} (${r.version})`,
        changelog: r.notes || `Latest version of ${entry.name} from BeamNG.com.`,
        prerelease: false,
        publishedAt: new Date().toISOString(),
        downloadUrl: `beamng://${r.resourceId}/${r.slug}`,
        size: 0,
        downloads: 0
      }]
    }
    if (!entry.repo) return []
    const url = `https://api.github.com/repos/${entry.repo}/releases?per_page=20`
    interface RawAsset { name: string; browser_download_url: string; size: number; download_count: number }
    interface RawRelease { tag_name: string; name: string; body: string; prerelease: boolean; published_at: string; assets: RawAsset[] }
    const raw = await this.fetchJson(url)
    if (!Array.isArray(raw)) return []
    const releases = raw as RawRelease[]
    return releases
      .filter((r) => r.assets.length > 0)
      .map((r) => {
        const asset = r.assets.find((a) => a.name.toLowerCase().endsWith('.zip')) ?? r.assets[0]
        return {
          version: r.tag_name,
          name: r.name || r.tag_name,
          changelog: r.body || '',
          prerelease: r.prerelease,
          publishedAt: r.published_at,
          downloadUrl: asset.browser_download_url,
          size: asset.size,
          downloads: asset.download_count
        }
      })
  }

  async installPlugin(
    pluginId: string,
    version: string,
    downloadUrl: string,
    serverDir: string,
    category: PluginCategory = 'career'
  ): Promise<{ success: boolean; error?: string }> {
    const entry = this.requireEntry(pluginId, category)
    try {
      await mkdir(this.tmpDir, { recursive: true })
      const safeVersion = version.replace(/[^a-zA-Z0-9._-]/g, '_')
      const fileName = `${entry.id}_${safeVersion}.zip`
      const zipPath = join(this.tmpDir, fileName)
      await this.downloadFile(downloadUrl, zipPath)

      // Remove any prior install before laying down new files so we don't accumulate stale ones.
      await this.uninstallPlugin(pluginId, serverDir, category).catch(() => { /* ignore */ })

      let artifacts: string[] = []
      switch (entry.installMethod) {
        case 'extract-to-root': {
          artifacts = await this.extractZipTracked(zipPath, serverDir)
          break
        }
        case 'extract-to-server-plugin': {
          const folderName = entry.serverPluginFolder || entry.id
          const dest = join(serverDir, 'Resources', 'Server', folderName)
          await mkdir(dest, { recursive: true })
          await this.extractZipTracked(zipPath, dest)
          artifacts = [join('Resources', 'Server', folderName)]
          break
        }
        case 'copy-client-zip': {
          const clientDir = join(serverDir, 'Resources', 'Client')
          await mkdir(clientDir, { recursive: true })

          if (entry.clientZipPathInArchive) {
            const nestedName = await this.extractZipEntryToDir(zipPath, clientDir, entry.clientZipPathInArchive)
            if (!nestedName) {
              throw new Error(`Could not find nested client zip ${entry.clientZipPathInArchive} in release archive`)
            }
            artifacts = [join('Resources', 'Client', nestedName)]
          } else {
            const assetName = basename(new URL(downloadUrl).pathname) || `${entry.id}.zip`
            const destPath = join(clientDir, assetName)
            await copyFile(zipPath, destPath)
            artifacts = [join('Resources', 'Client', assetName)]
          }

          // Optional split install: some plugins publish the client mod as the release asset,
          // while server files live in the tagged source tree under a known subdirectory.
          if (entry.serverSourceFromTagSubdir) {
            if (!entry.repo) {
              throw new Error(`Plugin ${entry.id} is missing repo metadata required for serverSourceFromTagSubdir`)
            }
            const tag = this.parseGitHubReleaseTagFromDownloadUrl(downloadUrl)
            if (!tag) {
              throw new Error(`Could not infer release tag from download URL for ${entry.id}`)
            }
            const sourceZipPath = join(this.tmpDir, `${entry.id}_${safeVersion}_source.zip`)
            const sourceZipUrl = `https://codeload.github.com/${entry.repo}/zip/refs/tags/${encodeURIComponent(tag)}`
            await this.downloadFile(sourceZipUrl, sourceZipPath)

            const folderName = entry.serverPluginFolder || entry.id
            const serverPluginDir = join(serverDir, 'Resources', 'Server', folderName)
            await mkdir(serverPluginDir, { recursive: true })
            const extracted = await this.extractZipSubdirTracked(sourceZipPath, serverPluginDir, entry.serverSourceFromTagSubdir)
            await rm(sourceZipPath, { force: true }).catch(() => {})
            if (extracted.length === 0) {
              throw new Error(`No files found in tagged source for ${entry.serverSourceFromTagSubdir}`)
            }
            artifacts.push(join('Resources', 'Server', folderName))
          }
          break
        }
      }

      await this.recordInstalled(serverDir, category, {
        pluginId: entry.id,
        version,
        installedAt: new Date().toISOString(),
        artifacts
      })

      await rm(zipPath, { force: true }).catch(() => {})
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  /**
   * Install a plugin whose zip is already on disk (e.g. fetched via the BeamNG.com
   * cookie-authenticated download flow). Currently only supports `copy-client-zip`
   * style entries — the zip is copied verbatim into `Resources/Client/` of the
   * selected hosted server and tracked for uninstall.
   */
  async installPluginFromLocalZip(
    pluginId: string,
    version: string,
    localZipPath: string,
    fileName: string,
    serverDir: string,
    category: PluginCategory = 'career'
  ): Promise<{ success: boolean; error?: string }> {
    const entry = this.requireEntry(pluginId, category)
    if (entry.installMethod !== 'copy-client-zip') {
      return { success: false, error: `installPluginFromLocalZip: unsupported installMethod ${entry.installMethod}` }
    }
    try {
      // Wipe any prior install of this plugin first so we don't leave stale zips behind
      // (e.g. a different filename from a previous version).
      await this.uninstallPlugin(pluginId, serverDir, category).catch(() => { /* ignore */ })

      const safeName = fileName.replace(/[\\/]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_') || `${entry.id}.zip`
      const clientDir = join(serverDir, 'Resources', 'Client')
      await mkdir(clientDir, { recursive: true })
      const destPath = join(clientDir, safeName)
      await copyFile(localZipPath, destPath)
      const artifacts = [join('Resources', 'Client', safeName)]

      await this.recordInstalled(serverDir, category, {
        pluginId: entry.id,
        version,
        installedAt: new Date().toISOString(),
        artifacts
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  async uninstallPlugin(pluginId: string, serverDir: string, category: PluginCategory = 'career'): Promise<{ success: boolean; error?: string }> {
    try {
      const tracking = await this.readTracking(serverDir, category)
      const installed = tracking.plugins[pluginId]
      // Refuse to delete well-known top-level server directories. This protects against legacy
      // tracking files from older CM versions that tracked coarse artifacts like "Resources",
      // which would otherwise wipe the entire server's content on uninstall.
      const PROTECTED = new Set(['', '.', 'Resources', 'Resources/Server', 'Resources/Client'])
      const dirsToPrune = new Set<string>()
      const resolvedServer = resolvePath(serverDir)
      const failures: string[] = []

      // Build the artifact list. Start from tracking; if missing, fall back to the catalog
      // entry's known install folder so users can still clean up plugins installed by older
      // CM versions (or where tracking was lost).
      const rawArtifacts: string[] = installed ? [...installed.artifacts] : []
      const catalogEntry = catalogFor(category).find((p) => p.id === pluginId)
      if (catalogEntry) {
        const folder = catalogEntry.serverPluginFolder || catalogEntry.id
        // Defensively include the well-known plugin folder location(s) so leftover files
        // get cleaned even if the install tracked them piecewise.
        if (catalogEntry.installMethod === 'extract-to-server-plugin') {
          rawArtifacts.push(join('Resources', 'Server', folder))
        } else if (catalogEntry.installMethod === 'extract-to-root' && folder) {
          // Most extract-to-root plugins land under Resources/Server/<folder>.
          rawArtifacts.push(join('Resources', 'Server', folder))
        }
      }
      // De-duplicate while preserving order.
      const artifacts = Array.from(new Set(rawArtifacts.map((a) => a.replace(/\\/g, '/').replace(/\/+$/, ''))))

      // Nothing tracked AND no catalog hint — treat as already uninstalled.
      if (artifacts.length === 0) {
        if (installed) {
          delete tracking.plugins[pluginId]
          await this.writeTracking(serverDir, category, tracking)
        }
        return { success: true }
      }

      for (const rel of artifacts) {
        if (PROTECTED.has(rel)) continue
        const full = join(serverDir, rel)
        const resolvedFull = resolvePath(full)
        // Path traversal guard: full path must live strictly inside serverDir.
        if (resolvedFull === resolvedServer) continue
        if (!resolvedFull.startsWith(resolvedServer + sep)) continue
        if (!existsSync(full)) {
          // Already gone — fine, queue parent for pruning and move on.
        } else {
          try {
            await rm(full, { recursive: true, force: true })
          } catch (err) {
            failures.push(`${rel}: ${(err as Error).message || String(err)}`)
            continue
          }
          // Verify it is actually gone (Windows can silently leave locked files behind on
          // some node/electron versions when force is set).
          if (existsSync(full)) {
            failures.push(`${rel}: file/folder still present after delete (in use?)`)
            continue
          }
        }
        // Queue ancestor dirs for empty-dir pruning.
        let parent = dirname(rel)
        while (parent && parent !== '.' && !PROTECTED.has(parent)) {
          dirsToPrune.add(parent)
          parent = dirname(parent)
        }
      }

      // Prune deepest first so parents become eligible as children are removed.
      const sortedDirs = Array.from(dirsToPrune).sort((a, b) => b.length - a.length)
      for (const d of sortedDirs) {
        const full = join(serverDir, d)
        try {
          const entries = await readdir(full)
          if (entries.length === 0) await rmdir(full).catch(() => {})
        } catch { /* ignore */ }
      }

      if (failures.length > 0) {
        return {
          success: false,
          error:
            'Could not fully remove plugin files (server may be running and holding them open):\n  - ' +
            failures.join('\n  - ')
        }
      }

      delete tracking.plugins[pluginId]
      await this.writeTracking(serverDir, category, tracking)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  /**
   * Read the per-server tracking file and validate every recorded plugin
   * against disk.  An entry is dropped (and the tracking file rewritten) if
   * none of its artifacts exist anymore — typically because the user wiped
   * Resources/ manually.  Without this round-trip the renderer would keep
   * showing "installed" badges for plugins whose files are long gone.
   */
  async getInstalledPlugins(serverDir: string, category: PluginCategory = 'career'): Promise<Record<string, InstalledPlugin>> {
    const tracking = await this.readTracking(serverDir, category)
    let mutated = false
    for (const id of Object.keys(tracking.plugins)) {
      const entry = tracking.plugins[id]
      const artifacts = entry.artifacts || []
      if (artifacts.length === 0) continue
      const stillThere = artifacts.some((rel) => {
        const normalized = rel.replace(/\\/g, '/').replace(/\/+$/, '')
        if (!normalized || normalized === '.' ) return false
        return existsSync(join(serverDir, normalized))
      })
      if (!stillThere) {
        delete tracking.plugins[id]
        mutated = true
      }
    }
    if (mutated) {
      try { await this.writeTracking(serverDir, category, tracking) } catch { /* ignore */ }
    }
    return tracking.plugins
  }

  /* ── Internals ── */

  private requireEntry(pluginId: string, category: PluginCategory = 'career'): PluginCatalogEntry {
    const e = catalogFor(category).find((p) => p.id === pluginId)
    if (!e) throw new Error(`Unknown plugin id: ${pluginId}`)
    return e
  }

  private async readTracking(serverDir: string, category: PluginCategory): Promise<InstalledPluginsFile> {
    const p = join(serverDir, trackingFileFor(category))
    if (!existsSync(p)) return { plugins: {} }
    try {
      const raw = await readFile(p, 'utf-8')
      const parsed = JSON.parse(raw) as InstalledPluginsFile
      return { plugins: parsed.plugins ?? {} }
    } catch {
      return { plugins: {} }
    }
  }

  private async writeTracking(serverDir: string, category: PluginCategory, data: InstalledPluginsFile): Promise<void> {
    const p = join(serverDir, trackingFileFor(category))
    await writeFile(p, JSON.stringify(data, null, 2), 'utf-8')
  }

  private async recordInstalled(serverDir: string, category: PluginCategory, plugin: InstalledPlugin): Promise<void> {
    const t = await this.readTracking(serverDir, category)
    t.plugins[plugin.pluginId] = plugin
    await this.writeTracking(serverDir, category, t)
  }

  /**
   * Extract a zip into destDir, returning the list of file paths written
   * (relative to destDir, forward-slash separated) for precise uninstall.
   * Performs a path-traversal guard.
   */
  private extractZipTracked(zipPath: string, destDir: string): Promise<string[]> {
    return new Promise((resolvePromise, reject) => {
      yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
        if (err || !zipFile) { reject(err ?? new Error('Failed to open zip')); return }

        const files: string[] = []
        const resolvedDest = resolvePath(destDir)
        zipFile.readEntry()

        zipFile.on('entry', (entry: Entry) => {
          const entryPath = join(destDir, entry.fileName)
          const resolvedEntry = resolvePath(entryPath)
          if (resolvedEntry !== resolvedDest && !resolvedEntry.startsWith(resolvedDest + sep)) {
            zipFile.readEntry()
            return
          }

          if (/\/$/.test(entry.fileName)) {
            mkdir(entryPath, { recursive: true })
              .then(() => zipFile.readEntry())
              .catch(() => zipFile.readEntry())
          } else {
            mkdir(dirname(entryPath), { recursive: true })
              .then(() => {
                zipFile.openReadStream(entry, (sErr, stream) => {
                  if (sErr || !stream) { zipFile.readEntry(); return }
                  const ws = createWriteStream(entryPath)
                  stream.pipe(ws)
                  ws.on('finish', () => {
                    files.push(entry.fileName.replace(/\\/g, '/'))
                    zipFile.readEntry()
                  })
                  ws.on('error', () => zipFile.readEntry())
                })
              })
              .catch(() => zipFile.readEntry())
          }
        })

        zipFile.on('end', () => {
          zipFile.close()
          resolvePromise(files)
        })
        zipFile.on('error', (e) => reject(e))
      })
    })
  }

  /**
   * Extract only a subdirectory from a zip into destDir.
   * `subdir` is matched by path segments (case-insensitive), so it works even
   * when source zips have an extra top-level folder.
   */
  private extractZipSubdirTracked(zipPath: string, destDir: string, subdir: string): Promise<string[]> {
    return new Promise((resolvePromise, reject) => {
      yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
        if (err || !zipFile) { reject(err ?? new Error('Failed to open zip')); return }

        const files: string[] = []
        const resolvedDest = resolvePath(destDir)
        const targetSegs = subdir.split('/').filter(Boolean).map((s) => s.toLowerCase())
        zipFile.readEntry()

        zipFile.on('entry', (entry: Entry) => {
          const rawName = entry.fileName.replace(/\\/g, '/')
          const segs = rawName.split('/').filter(Boolean)
          const lower = segs.map((s) => s.toLowerCase())

          let relSegStart = -1
          for (let i = 0; i <= lower.length - targetSegs.length; i++) {
            let ok = true
            for (let j = 0; j < targetSegs.length; j++) {
              if (lower[i + j] !== targetSegs[j]) { ok = false; break }
            }
            if (ok) {
              relSegStart = i + targetSegs.length
              break
            }
          }

          if (relSegStart < 0) {
            zipFile.readEntry()
            return
          }

          const relPath = segs.slice(relSegStart).join('/')
          if (!relPath) {
            zipFile.readEntry()
            return
          }

          const entryPath = join(destDir, relPath)
          const resolvedEntry = resolvePath(entryPath)
          if (resolvedEntry !== resolvedDest && !resolvedEntry.startsWith(resolvedDest + sep)) {
            zipFile.readEntry()
            return
          }

          if (/\/$/.test(rawName)) {
            mkdir(entryPath, { recursive: true })
              .then(() => zipFile.readEntry())
              .catch(() => zipFile.readEntry())
          } else {
            mkdir(dirname(entryPath), { recursive: true })
              .then(() => {
                zipFile.openReadStream(entry, (sErr, stream) => {
                  if (sErr || !stream) { zipFile.readEntry(); return }
                  const ws = createWriteStream(entryPath)
                  stream.pipe(ws)
                  ws.on('finish', () => {
                    files.push(relPath)
                    zipFile.readEntry()
                  })
                  ws.on('error', () => zipFile.readEntry())
                })
              })
              .catch(() => zipFile.readEntry())
          }
        })

        zipFile.on('end', () => {
          zipFile.close()
          resolvePromise(files)
        })
        zipFile.on('error', (e) => reject(e))
      })
    })
  }

  /**
   * Extract a single file entry from a zip to destDir by matching a trailing
   * archive path (case-insensitive, segment-aware).
   * Returns the output file name when extracted, otherwise null.
   */
  private extractZipEntryToDir(zipPath: string, destDir: string, targetArchivePath: string): Promise<string | null> {
    return new Promise((resolvePromise, reject) => {
      yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
        if (err || !zipFile) { reject(err ?? new Error('Failed to open zip')); return }

        const targetSegs = targetArchivePath.split('/').filter(Boolean).map((s) => s.toLowerCase())
        const resolvedDest = resolvePath(destDir)
        let resolved = false

        zipFile.readEntry()

        zipFile.on('entry', (entry: Entry) => {
          if (resolved) return
          const rawName = entry.fileName.replace(/\\/g, '/')
          if (/\/$/.test(rawName)) {
            zipFile.readEntry()
            return
          }

          const segs = rawName.split('/').filter(Boolean)
          const lower = segs.map((s) => s.toLowerCase())
          const tail = lower.slice(Math.max(0, lower.length - targetSegs.length))
          const matches = tail.length === targetSegs.length && tail.every((s, i) => s === targetSegs[i])
          if (!matches) {
            zipFile.readEntry()
            return
          }

          const fileName = basename(rawName)
          const outPath = join(destDir, fileName)
          const resolvedOut = resolvePath(outPath)
          if (resolvedOut !== resolvedDest && !resolvedOut.startsWith(resolvedDest + sep)) {
            zipFile.readEntry()
            return
          }

          mkdir(dirname(outPath), { recursive: true })
            .then(() => {
              zipFile.openReadStream(entry, (sErr, stream) => {
                if (sErr || !stream) { zipFile.readEntry(); return }
                const ws = createWriteStream(outPath)
                stream.pipe(ws)
                ws.on('finish', () => {
                  resolved = true
                  zipFile.close()
                  resolvePromise(fileName)
                })
                ws.on('error', (e) => reject(e))
              })
            })
            .catch(() => zipFile.readEntry())
        })

        zipFile.on('end', () => {
          if (resolved) return
          zipFile.close()
          resolvePromise(null)
        })
        zipFile.on('error', (e) => reject(e))
      })
    })
  }

  private parseGitHubReleaseTagFromDownloadUrl(downloadUrl: string): string | null {
    try {
      const u = new URL(downloadUrl)
      const segs = u.pathname.split('/').filter(Boolean)
      const idx = segs.findIndex((s) => s.toLowerCase() === 'download')
      if (idx >= 0 && idx + 1 < segs.length) return segs[idx + 1]
      return null
    } catch {
      return null
    }
  }

  private fetchJson(url: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const doGet = (u: string): void => {
        httpsGet(u, { headers: { 'User-Agent': 'BeamMP-ContentManager' } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doGet(res.headers.location)
            return
          }
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
            catch (e) { reject(e) }
          })
          res.on('error', reject)
        }).on('error', reject)
      }
      doGet(url)
    })
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const doGet = (u: string): void => {
        httpsGet(u, { headers: { 'User-Agent': 'BeamMP-ContentManager' } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            doGet(res.headers.location)
            return
          }
          const ws = createWriteStream(dest)
          res.pipe(ws)
          ws.on('finish', () => { ws.close(); resolve() })
          ws.on('error', reject)
          res.on('error', reject)
        }).on('error', reject)
      }
      doGet(url)
    })
  }
}
