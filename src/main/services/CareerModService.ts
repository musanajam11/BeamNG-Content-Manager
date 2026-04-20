import { get as httpsGet } from 'https'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, readFile, writeFile, rm, readdir, rmdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { app } from 'electron'
import { open as yauzlOpen, type Entry } from 'yauzl'

/* ── Types ── */

export interface GitHubRelease {
  tag_name: string
  name: string
  body: string
  prerelease: boolean
  published_at: string
  assets: GitHubAsset[]
}

export interface GitHubAsset {
  name: string
  browser_download_url: string
  size: number
  download_count: number
}

export interface CareerMPRelease {
  version: string
  name: string
  changelog: string
  prerelease: boolean
  publishedAt: string
  downloadUrl: string
  size: number
  downloads: number
}

export interface RLSRelease {
  version: string
  rlsBaseVersion: string
  name: string
  changelog: string
  prerelease: boolean
  publishedAt: string
  trafficUrl: string | null
  noTrafficUrl: string | null
  trafficSize: number
  noTrafficSize: number
  downloads: number
}

export interface InstalledCareerMods {
  careerMP: { version: string; installedAt: string; installedFiles?: string[] } | null
  rls: { version: string; traffic: boolean; installedAt: string; installedFile?: string } | null
}

/**
 * Shape of the CareerMP `config.json` generated at
 * `{serverDir}/Resources/Server/CareerMP/config/config.json` the first time
 * the server is started with CareerMP installed.
 *
 * Schema mirrors `defaultConfig` in CareerMP's server `careerMP.lua`. Unknown
 * keys are preserved by round-tripping through the raw JSON so newer CareerMP
 * versions stay forward-compatible.
 */
export interface CareerMPServerConfig {
  server: {
    autoUpdate: boolean
    autoRestart: boolean
    allowTransactions: boolean
    sessionSendingMax: number
    sessionReceiveMax: number
    shortWindowMax: number
    shortWindowSeconds: number
    longWindowMax: number
    longWindowSeconds: number
    [key: string]: unknown
  }
  client: {
    allGhost: boolean
    unicycleGhost: boolean
    serverSaveName: string
    serverSaveSuffix: string
    serverSaveNameEnabled: boolean
    roadTrafficAmount: number
    parkedTrafficAmount: number
    roadTrafficEnabled: boolean
    parkedTrafficEnabled: boolean
    worldEditorEnabled: boolean
    consoleEnabled: boolean
    simplifyRemoteVehicles: boolean
    spawnVehicleIgnitionLevel: number
    skipOtherPlayersVehicles: boolean
    trafficSmartSelections: boolean
    trafficSimpleVehicles: boolean
    trafficAllowMods: boolean
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * Shape of the four user-tunable keys in
 * `{serverDir}/Resources/Server/CareerMPTraffic/settings.txt` (BeamMP Dynamic
 * Traffic by DeadEndReece). Mirrors the keys written by `SaveSettings()` in
 * that plugin's `main.lua`. Admins are intentionally NOT modelled here — they
 * are preserved verbatim during round-trip and managed in-server via console
 * commands (`traffic.au`, `traffic.ru`).
 */
export interface DynamicTrafficConfig {
  /** Max AI cars spawned per connected player. Default: 1. */
  aisPerPlayer: number
  /** Hard cap on total AI traffic across the server. Default: 8. */
  maxServerTraffic: number
  /** When true, AI traffic passes through players (no collisions). Default: true. */
  trafficGhosting: boolean
  /** When true, sends chat countdowns/warnings before traffic (re)spawns. Default: true. */
  trafficSpawnWarnings: boolean
}

/**
 * Parse a DT `settings.txt` file and return its four tunables. Unknown keys
 * and the whole `[Admins]` section are ignored (they round-trip via
 * `extractDynamicTrafficAdminsBlock`).
 */
function parseDynamicTrafficSettings(raw: string): DynamicTrafficConfig {
  const cfg: DynamicTrafficConfig = {
    aisPerPlayer: 1,
    maxServerTraffic: 8,
    trafficGhosting: true,
    trafficSpawnWarnings: true
  }
  let section = ''
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue
    const sectionMatch = line.match(/^\[(.+)\]$/)
    if (sectionMatch) { section = sectionMatch[1]; continue }
    if (section && section.toLowerCase() !== 'config') continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    switch (key) {
      case 'aisPerPlayer': {
        const n = Number(value)
        if (Number.isFinite(n)) cfg.aisPerPlayer = n
        break
      }
      case 'maxServerTraffic': {
        const n = Number(value)
        if (Number.isFinite(n)) cfg.maxServerTraffic = n
        break
      }
      case 'trafficGhosting':
        cfg.trafficGhosting = value.toLowerCase() === 'true'
        break
      case 'trafficSpawnWarnings':
        cfg.trafficSpawnWarnings = value.toLowerCase() === 'true'
        break
      default:
        break
    }
  }
  return cfg
}

/**
 * Return the raw `[Admins]` section (header + body up to EOF or next `[…]`
 * header) so we can round-trip it unchanged when rewriting settings.txt.
 * Returns an empty string if no admins section is present.
 */
function extractDynamicTrafficAdminsBlock(raw: string): string {
  const lines = raw.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === '[admins]') { start = i; break }
  }
  if (start === -1) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\[.+\]$/.test(lines[i].trim())) { end = i; break }
  }
  // Normalise to end with a single trailing newline.
  const block = lines.slice(start, end).join('\n').replace(/\s+$/, '')
  return block + '\n'
}

/* ── Service ── */

export class CareerModService {
  private tmpDir: string

  constructor() {
    this.tmpDir = join(app.getPath('temp'), 'beamcm-career-mods')
  }

  /* ── GitHub API ── */

  async fetchCareerMPReleases(): Promise<CareerMPRelease[]> {
    const raw = await this.fetchJson(
      'https://api.github.com/repos/StanleyDudek/CareerMP/releases?per_page=30'
    )
    if (!Array.isArray(raw)) return []
    const releases = raw as GitHubRelease[]

    return releases
      .filter((r) => r.assets.length > 0)
      // GitHub returns releases ordered by created_at desc, but a release
      // cut from an older draft/tag can have an older created_at than a
      // newer release. Sort by published_at desc so the most recently
      // published version is always first (and becomes the auto-selected
      // default in the UI).
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
      .map((r) => {
        const asset = r.assets.find((a) => a.name.endsWith('.zip')) ?? r.assets[0]
        return {
          version: r.tag_name,
          name: r.name,
          changelog: r.body || '',
          prerelease: r.prerelease,
          publishedAt: r.published_at,
          downloadUrl: asset.browser_download_url,
          size: asset.size,
          downloads: asset.download_count
        }
      })
  }

  async fetchRLSReleases(): Promise<RLSRelease[]> {
    const raw = await this.fetchJson(
      'https://api.github.com/repos/PapiCheesecake/rls_careermp/releases?per_page=30'
    )
    if (!Array.isArray(raw)) return []
    const releases = raw as GitHubRelease[]

    return releases
      .filter((r) => r.assets.length > 0)
      // Sort by published_at desc — see fetchCareerMPReleases for rationale.
      // E.g. v3.8 was created from a v3.7-era draft so its created_at predates
      // v3.7's, even though v3.8 was published later.
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
      .map((r) => {
        const trafficAsset = r.assets.find(
          (a) => a.name.endsWith('.zip') && !a.name.includes('NoTraffic')
        ) ?? null
        const noTrafficAsset = r.assets.find(
          (a) => a.name.includes('NoTraffic') && a.name.endsWith('.zip')
        ) ?? null

        // Parse the RLS base version from asset name like RLS_2.6.4_MPv3.7.zip
        let rlsBaseVersion = ''
        const match = (trafficAsset?.name ?? noTrafficAsset?.name ?? '').match(/RLS_([^_]+)_/)
        if (match) rlsBaseVersion = match[1]

        const totalDownloads = r.assets.reduce((sum, a) => sum + a.download_count, 0)

        return {
          version: r.tag_name,
          rlsBaseVersion,
          name: r.name,
          changelog: r.body || '',
          prerelease: r.prerelease,
          publishedAt: r.published_at,
          trafficUrl: trafficAsset?.browser_download_url ?? null,
          noTrafficUrl: noTrafficAsset?.browser_download_url ?? null,
          trafficSize: trafficAsset?.size ?? 0,
          noTrafficSize: noTrafficAsset?.size ?? 0,
          downloads: totalDownloads
        }
      })
  }

  /* ── Install CareerMP ── */

  async installCareerMP(
    downloadUrl: string,
    version: string,
    serverDir: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await mkdir(this.tmpDir, { recursive: true })
      const zipPath = join(this.tmpDir, `CareerMP_${version}.zip`)

      // Remove files installed by the previous CareerMP version (if tracked)
      // before extracting the new one. Without this, files removed/renamed
      // upstream linger forever and can break the new version at runtime.
      await this.removePreviouslyInstalledFiles(serverDir, 'careerMP')

      // Download
      await this.downloadFile(downloadUrl, zipPath)

      // Extract to server root (CareerMP extracts its Resources/ folder to server root)
      const installedFiles = await this.extractZipToDir(zipPath, serverDir)

      // Track installed version + the exact files placed by this install so a
      // future re-install/upgrade can clean them up.
      await this.saveInstalledVersion(serverDir, 'careerMP', {
        version,
        installedAt: new Date().toISOString(),
        installedFiles
      })

      // Cleanup temp
      await rm(zipPath, { force: true }).catch(() => {})

      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  /* ── Install RLS ── */

  async installRLS(
    downloadUrl: string,
    version: string,
    traffic: boolean,
    serverDir: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await mkdir(this.tmpDir, { recursive: true })
      const fileName = `RLS_${version}${traffic ? '' : '_NoTraffic'}.zip`
      const zipPath = join(this.tmpDir, fileName)
      const clientDir = join(serverDir, 'Resources', 'Client')
      await mkdir(clientDir, { recursive: true })

      // Remove every previously-deployed RLS zip in Resources/Client. Match
      // any RLS_*.zip (and the NoTraffic variant) so switching versions never
      // leaves the old client zip behind — BeamMP would otherwise serve both
      // to clients and conflict.
      await this.removeStaleRlsZips(clientDir)

      // Download
      await this.downloadFile(downloadUrl, zipPath)

      // Copy zip to Resources/Client
      const destPath = join(clientDir, fileName)
      const { copyFile } = await import('node:fs/promises')
      await copyFile(zipPath, destPath)

      // Track installed version + the deployed zip path so future installs
      // can verify cleanup.
      await this.saveInstalledVersion(serverDir, 'rls', {
        version,
        traffic,
        installedAt: new Date().toISOString(),
        installedFile: destPath
      })

      // Cleanup temp
      await rm(zipPath, { force: true }).catch(() => {})

      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  /* ── CareerMP server config.json ── */

  async getCareerMPServerConfig(serverDir: string): Promise<{
    installed: boolean
    exists: boolean
    config: CareerMPServerConfig | null
    raw: string | null
  }> {
    const installed = await this.getInstalledMods(serverDir)
    if (!installed.careerMP) {
      return { installed: false, exists: false, config: null, raw: null }
    }
    const configPath = join(serverDir, 'Resources', 'Server', 'CareerMP', 'config', 'config.json')
    if (!existsSync(configPath)) {
      return { installed: true, exists: false, config: null, raw: null }
    }
    try {
      const raw = await readFile(configPath, 'utf-8')
      const parsed = JSON.parse(raw) as CareerMPServerConfig
      return { installed: true, exists: true, config: parsed, raw }
    } catch (e) {
      return { installed: true, exists: false, config: null, raw: String(e) }
    }
  }

  async saveCareerMPServerConfig(
    serverDir: string,
    config: CareerMPServerConfig
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const installed = await this.getInstalledMods(serverDir)
      if (!installed.careerMP) {
        return { success: false, error: 'CareerMP is not installed in this server.' }
      }
      const configDir = join(serverDir, 'Resources', 'Server', 'CareerMP', 'config')
      await mkdir(configDir, { recursive: true })
      const configPath = join(configDir, 'config.json')
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  /* ── Dynamic Traffic settings.txt ── */
  /*
   * DT persists config + admin list at
   * `{serverDir}/Resources/Server/CareerMPTraffic/settings.txt`. Format is a
   * simple INI-like file with `[Config]` (4 tunables) and `[Admins]` (id=name).
   * We round-trip the admins section verbatim so edits from the CM only touch
   * the four Config keys.
   */

  async getDynamicTrafficConfig(serverDir: string): Promise<{
    installed: boolean
    exists: boolean
    config: DynamicTrafficConfig | null
  }> {
    const pluginDir = join(serverDir, 'Resources', 'Server', 'CareerMPTraffic')
    const mainLua = join(pluginDir, 'main.lua')
    if (!existsSync(mainLua)) {
      return { installed: false, exists: false, config: null }
    }
    const settingsPath = join(pluginDir, 'settings.txt')
    if (!existsSync(settingsPath)) {
      return { installed: true, exists: false, config: null }
    }
    try {
      const raw = await readFile(settingsPath, 'utf-8')
      const parsed = parseDynamicTrafficSettings(raw)
      return { installed: true, exists: true, config: parsed }
    } catch {
      return { installed: true, exists: false, config: null }
    }
  }

  async saveDynamicTrafficConfig(
    serverDir: string,
    config: DynamicTrafficConfig
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const pluginDir = join(serverDir, 'Resources', 'Server', 'CareerMPTraffic')
      const mainLua = join(pluginDir, 'main.lua')
      if (!existsSync(mainLua)) {
        return { success: false, error: 'BeamMP Dynamic Traffic is not installed in this server.' }
      }
      await mkdir(pluginDir, { recursive: true })
      const settingsPath = join(pluginDir, 'settings.txt')

      // Preserve any existing [Admins] lines verbatim.
      let adminsBlock = ''
      if (existsSync(settingsPath)) {
        try {
          const existing = await readFile(settingsPath, 'utf-8')
          adminsBlock = extractDynamicTrafficAdminsBlock(existing)
        } catch { /* fall through */ }
      }

      const out =
        '[Config]\n' +
        `aisPerPlayer=${config.aisPerPlayer}\n` +
        `maxServerTraffic=${config.maxServerTraffic}\n` +
        `trafficGhosting=${config.trafficGhosting ? 'true' : 'false'}\n` +
        `trafficSpawnWarnings=${config.trafficSpawnWarnings ? 'true' : 'false'}\n` +
        '\n' +
        (adminsBlock || '[Admins]\n')

      await writeFile(settingsPath, out, 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  /* ── Check installed versions ── */

  async getInstalledMods(serverDir: string): Promise<InstalledCareerMods> {
    const metaPath = join(serverDir, 'career-mods.json')
    if (!existsSync(metaPath)) return { careerMP: null, rls: null }
    try {
      const raw = await readFile(metaPath, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return { careerMP: null, rls: null }
    }
  }

  /* ── Internals ── */

  private async saveInstalledVersion(
    serverDir: string,
    key: 'careerMP' | 'rls',
    data: Record<string, unknown>
  ): Promise<void> {
    const metaPath = join(serverDir, 'career-mods.json')
    let existing: Record<string, unknown> = { careerMP: null, rls: null }
    if (existsSync(metaPath)) {
      try { existing = JSON.parse(await readFile(metaPath, 'utf-8')) } catch { /* */ }
    }
    existing[key] = data
    await writeFile(metaPath, JSON.stringify(existing, null, 2), 'utf-8')
  }

  private extractZipToDir(zipPath: string, destDir: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
        if (err || !zipFile) { reject(err ?? new Error('Failed to open zip')); return }

        const installedFiles: string[] = []
        zipFile.readEntry()

        zipFile.on('entry', (entry: Entry) => {
          const entryPath = join(destDir, entry.fileName)
          // Path traversal guard
          if (!entryPath.startsWith(destDir)) {
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
                  ws.on('finish', () => { installedFiles.push(entryPath); zipFile.readEntry() })
                  ws.on('error', () => zipFile.readEntry())
                })
              })
              .catch(() => zipFile.readEntry())
          }
        })

        zipFile.on('end', () => { zipFile.close(); resolve(installedFiles) })
        zipFile.on('error', (e) => reject(e))
      })
    })
  }

  /**
   * Delete every `RLS*.zip` (and `RLS*_NoTraffic.zip`) currently sitting in
   * the server's `Resources/Client` directory. Called immediately before
   * deploying a fresh RLS zip so version switches don't leave the previous
   * version's client zip behind for the BeamMP launcher to also serve.
   */
  private async removeStaleRlsZips(clientDir: string): Promise<void> {
    if (!existsSync(clientDir)) return
    try {
      const entries = await readdir(clientDir)
      for (const name of entries) {
        if (/^RLS.*\.zip$/i.test(name)) {
          await rm(join(clientDir, name), { force: true }).catch(() => {})
        }
      }
    } catch { /* ignore */ }
  }

  /**
   * Remove the exact set of files placed by the previous install of `key`
   * (CareerMP / RLS) as recorded in `career-mods.json`. After deleting files,
   * walks parent directories bottom-up and removes any that are now empty.
   * Silently no-ops if no prior install was tracked.
   */
  private async removePreviouslyInstalledFiles(
    serverDir: string,
    key: 'careerMP' | 'rls'
  ): Promise<void> {
    const installed = await this.getInstalledMods(serverDir)
    const entry = installed[key] as { installedFiles?: string[] } | null
    const files = entry?.installedFiles
    if (!files || files.length === 0) return
    const dirsToCheck = new Set<string>()
    for (const f of files) {
      // Path-traversal guard: only delete inside serverDir
      if (!f.startsWith(serverDir)) continue
      await rm(f, { force: true }).catch(() => {})
      dirsToCheck.add(dirname(f))
    }
    // Remove now-empty parent directories, deepest first.
    const sortedDirs = Array.from(dirsToCheck).sort((a, b) => b.length - a.length)
    for (const dir of sortedDirs) {
      let cur = dir
      while (cur.startsWith(serverDir) && cur !== serverDir) {
        try {
          const remaining = await readdir(cur)
          if (remaining.length > 0) break
          await rmdir(cur)
          cur = dirname(cur)
        } catch { break }
      }
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
