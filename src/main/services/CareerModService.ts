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

/* ── Service ── */

export class CareerModService {
  private tmpDir: string

  constructor() {
    this.tmpDir = join(app.getPath('temp'), 'beamcm-career-mods')
  }

  /* ── GitHub API ── */

  async fetchCareerMPReleases(): Promise<CareerMPRelease[]> {
    const releases = await this.fetchJson(
      'https://api.github.com/repos/StanleyDudek/CareerMP/releases?per_page=30'
    ) as GitHubRelease[]

    return releases
      .filter((r) => r.assets.length > 0)
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
    const releases = await this.fetchJson(
      'https://api.github.com/repos/PapiCheesecake/rls_careermp/releases?per_page=30'
    ) as GitHubRelease[]

    return releases
      .filter((r) => r.assets.length > 0)
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
