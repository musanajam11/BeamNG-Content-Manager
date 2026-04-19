import { get as httpsGet } from 'https'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
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
  /** GitHub `owner/repo`. */
  repo: string
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
}

/* ── Static catalog ── */
export const PLUGIN_CATALOG: PluginCatalogEntry[] = [
  {
    id: 'careermp-banking',
    name: 'CareerMP Banking',
    description: 'A QoL Banking app for CareerMP. Adds in-game banking commands.',
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
    description: 'The UBER app for BeamNG.Drive Career Mode — request rides between players.',
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
    description: 'Dynamic traffic spawning on your servers. Works with vanilla BeamMP and CareerMP.',
    author: 'DeadEndReece',
    repo: 'DeadEndReece/BeamMPDynamicTraffic',
    homepage: 'https://github.com/DeadEndReece/BeamMPDynamicTraffic',
    compat: 'both',
    installMethod: 'extract-to-root',
    serverPluginFolder: 'CareerMPTraffic'
  }
]

/* ── Server Admin Tools catalog (BeamMP/CobaltEssentials ecosystem) ── */
export const SERVER_ADMIN_CATALOG: PluginCatalogEntry[] = [
  {
    id: 'cobalt-essentials',
    name: 'CobaltEssentials',
    description: 'A powerful BeamMP server-side admin & permissions framework (kick, ban, teleport, vehicle controls, etc).',
    author: 'prestonelam2003',
    repo: 'prestonelam2003/CobaltEssentials',
    homepage: 'https://github.com/prestonelam2003/CobaltEssentials',
    compat: 'beamMP',
    installMethod: 'extract-to-server-plugin',
    serverPluginFolder: 'CobaltEssentials'
  },
  {
    id: 'cobalt-essentials-interface',
    name: 'CobaltEssentialsInterface (CEI)',
    description: 'Dear ImGui based in-game admin interface for BeamMP servers running CobaltEssentials.',
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
    description: 'Notify players of scheduled server restarts with customizable warnings.',
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
    description: 'Advanced chat filter for BeamMP servers with admin tools.',
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
    description: 'A quick-chat UI app for custom commands and racing countdowns. Client-side mod.',
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
  return category === 'admin' ? SERVER_ADMIN_CATALOG : PLUGIN_CATALOG
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
    const url = `https://api.github.com/repos/${entry.repo}/releases?per_page=20`
    interface RawAsset { name: string; browser_download_url: string; size: number; download_count: number }
    interface RawRelease { tag_name: string; name: string; body: string; prerelease: boolean; published_at: string; assets: RawAsset[] }
    const releases = (await this.fetchJson(url)) as RawRelease[]
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
          const assetName = basename(new URL(downloadUrl).pathname) || `${entry.id}.zip`
          const destPath = join(clientDir, assetName)
          await copyFile(zipPath, destPath)
          artifacts = [join('Resources', 'Client', assetName)]
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

  async uninstallPlugin(pluginId: string, serverDir: string, category: PluginCategory = 'career'): Promise<{ success: boolean; error?: string }> {
    try {
      const tracking = await this.readTracking(serverDir, category)
      const installed = tracking.plugins[pluginId]
      if (!installed) return { success: true }
      for (const rel of installed.artifacts) {
        const full = join(serverDir, rel)
        // Path traversal guard
        if (!full.startsWith(serverDir)) continue
        await rm(full, { recursive: true, force: true }).catch(() => {})
      }
      delete tracking.plugins[pluginId]
      await this.writeTracking(serverDir, category, tracking)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  async getInstalledPlugins(serverDir: string, category: PluginCategory = 'career'): Promise<Record<string, InstalledPlugin>> {
    const t = await this.readTracking(serverDir, category)
    return t.plugins
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
   * Extract a zip into destDir, returning the list of top-level entries created
   * (relative to destDir) for later uninstall. Performs a path-traversal guard.
   */
  private extractZipTracked(zipPath: string, destDir: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
        if (err || !zipFile) { reject(err ?? new Error('Failed to open zip')); return }

        const topLevel = new Set<string>()
        zipFile.readEntry()

        zipFile.on('entry', (entry: Entry) => {
          const entryPath = join(destDir, entry.fileName)
          if (!entryPath.startsWith(destDir)) {
            zipFile.readEntry()
            return
          }
          const top = entry.fileName.split(/[\\/]/, 1)[0]
          if (top) topLevel.add(top)

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
                  ws.on('finish', () => zipFile.readEntry())
                  ws.on('error', () => zipFile.readEntry())
                })
              })
              .catch(() => zipFile.readEntry())
          }
        })

        zipFile.on('end', () => {
          zipFile.close()
          // Best-effort relative path list. Avoid pruning siblings on uninstall.
          resolve(Array.from(topLevel))
        })
        zipFile.on('error', (e) => reject(e))
      })
    })
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
