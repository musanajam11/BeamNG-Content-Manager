import { get as httpsGet } from 'https'
import { createWriteStream, existsSync } from 'fs'
import { mkdir, readFile, writeFile, rm, readdir, rmdir, copyFile } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { app } from 'electron'
import { open as yauzlOpen, type Entry } from 'yauzl'
import { spawn } from 'node:child_process'

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

export interface GreatRebalanceDependencyRelease {
  version: string
  name: string
  prerelease: boolean
  publishedAt: string
  downloadUrl: string
}

export interface BetterCareerCompatRelease {
  version: string
  name: string
  changelog: string
  prerelease: boolean
  publishedAt: string
  clientZipUrl: string | null
  serverZipUrl: string | null
  clientZipSize: number
  serverZipSize: number
  downloads: number
}

/**
 * Discriminator for which install flow last wrote the CareerMP files for a
 * server. The four CareerMP flavours are mutually exclusive — only one set
 * of CareerMP files can be live on disk at a time — so we record which one
 * is active.  Without this, the UI cannot tell whether `careerMP` is a plain
 * install, the CareerMP-side of an RLS install, or the patched copy that
 * Better Career / RLS-TGR drop in (which share file names with each other).
 */
export type CareerMPVariant = 'plain' | 'rls' | 'betterCareer' | 'rls-tgr'

export interface InstalledCareerMods {
  careerMP: { version: string; installedAt: string; installedFiles?: string[]; variant?: CareerMPVariant } | null
  rls: { version: string; traffic: boolean; installedAt: string; installedFile?: string; variant?: CareerMPVariant } | null
  betterCareer: { version: string; installedAt: string; installedFiles?: string[] } | null
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

  async fetchGreatRebalanceRlsReleases(): Promise<GreatRebalanceDependencyRelease[]> {
    const raw = await this.fetchJson(
      'https://api.github.com/repos/RLS-Modding/rls_career_overhaul/releases?per_page=30'
    )
    if (!Array.isArray(raw)) return []

    const releases = raw as GitHubRelease[]
    return releases
      .map((r) => {
        const zipAsset = r.assets.find((a) => a.name.toLowerCase().endsWith('.zip'))
        return {
          version: r.tag_name,
          name: r.name || r.tag_name,
          prerelease: r.prerelease,
          publishedAt: r.published_at,
          downloadUrl: zipAsset?.browser_download_url ?? ''
        }
      })
      .filter((r) => /^v?2\.6\.5(\.|$)/i.test(r.version) && !!r.downloadUrl)
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
  }

  async fetchGreatRebalancePatchReleases(): Promise<GreatRebalanceDependencyRelease[]> {
    const raw = await this.fetchJson(
      'https://api.github.com/repos/ChiarelloB/RLS-CareerMP-Compatibility-Patch---Online-Career-Mode/releases?per_page=30'
    )
    if (!Array.isArray(raw)) {
      return [
        {
          version: 'main',
          name: 'main',
          prerelease: false,
          publishedAt: '',
          downloadUrl:
            'https://codeload.github.com/ChiarelloB/RLS-CareerMP-Compatibility-Patch---Online-Career-Mode/zip/refs/heads/main'
        }
      ]
    }

    const releases = raw as GitHubRelease[]
    const mapped = releases
      .map((r) => ({
        version: r.tag_name,
        name: r.name || r.tag_name,
        prerelease: r.prerelease,
        publishedAt: r.published_at,
        // Use codeload tar/zip of the tagged source tree so build_release.py is always present.
        downloadUrl: `https://codeload.github.com/ChiarelloB/RLS-CareerMP-Compatibility-Patch---Online-Career-Mode/zip/refs/tags/${encodeURIComponent(r.tag_name)}`
      }))
      .filter((r) => !!r.version && !!r.downloadUrl)
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())

    if (mapped.length > 0) return mapped
    return [
      {
        version: 'main',
        name: 'main',
        prerelease: false,
        publishedAt: '',
        downloadUrl:
          'https://codeload.github.com/ChiarelloB/RLS-CareerMP-Compatibility-Patch---Online-Career-Mode/zip/refs/heads/main'
      }
    ]
  }

  async fetchBetterCareerCompatReleases(): Promise<BetterCareerCompatRelease[]> {
    const raw = await this.fetchJson(
      'https://api.github.com/repos/ChiarelloB/better-career-careermp-compat/releases?per_page=30'
    )
    if (!Array.isArray(raw)) return []
    const releases = raw as GitHubRelease[]

    return releases
      .filter((r) => r.assets.length > 0)
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
      .map((r) => {
        const clientAsset = r.assets.find((a) => /careermp_bettercareer\.zip$/i.test(a.name)) ?? null
        const serverAsset = r.assets.find((a) => /careermp_bettercareer_server\.zip$/i.test(a.name)) ?? null
        const totalDownloads = r.assets.reduce((sum, a) => sum + a.download_count, 0)

        return {
          version: r.tag_name,
          name: r.name,
          changelog: r.body || '',
          prerelease: r.prerelease,
          publishedAt: r.published_at,
          clientZipUrl: clientAsset?.browser_download_url ?? null,
          serverZipUrl: serverAsset?.browser_download_url ?? null,
          clientZipSize: clientAsset?.size ?? 0,
          serverZipSize: serverAsset?.size ?? 0,
          downloads: totalDownloads
        }
      })
      .filter((r) => !!r.clientZipUrl && !!r.serverZipUrl)
  }

  /* ── Install CareerMP ── */

  async installCareerMP(
    downloadUrl: string,
    version: string,
    serverDir: string,
    variant: CareerMPVariant = 'plain'
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
      // future re-install/upgrade can clean them up.  `variant` records WHICH
      // CareerMP install flow wrote these files so the UI only lights up the
      // matching card (and only its uninstall button).
      await this.saveInstalledVersion(serverDir, 'careerMP', {
        version,
        installedAt: new Date().toISOString(),
        installedFiles,
        variant
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
      const sourceNameRaw = basename(new URL(downloadUrl).pathname)
      const sourceName = decodeURIComponent(sourceNameRaw || '')
      const fallbackName = `RLS_${version}${traffic ? '' : '_NoTraffic'}.zip`
      const fileName = sourceName.toLowerCase().endsWith('.zip') ? sourceName : fallbackName
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
      // can verify cleanup.  `variant: 'rls'` distinguishes a plain RLS
      // install from the GRB-patched ("compatible") RLS zip that the RLS-TGR
      // flow writes (which uses 'rls-tgr').
      await this.saveInstalledVersion(serverDir, 'rls', {
        version,
        traffic,
        installedAt: new Date().toISOString(),
        installedFile: destPath,
        variant: 'rls'
      })

      // Cleanup temp
      await rm(zipPath, { force: true }).catch(() => {})

      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  async installBetterCareerCompat(
    clientZipUrl: string,
    serverZipUrl: string,
    version: string,
    serverDir: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await mkdir(this.tmpDir, { recursive: true })
      const clientZipPath = join(this.tmpDir, `CareerMP_BetterCareer_client_${version}.zip`)
      const serverZipPath = join(this.tmpDir, `CareerMP_BetterCareer_server_${version}.zip`)
      const clientDir = join(serverDir, 'Resources', 'Client')
      await mkdir(clientDir, { recursive: true })

      // Replace any previously tracked CareerMP/Better Career files before deploying.
      await this.removePreviouslyInstalledFiles(serverDir, 'careerMP')
      await this.removePreviouslyInstalledFiles(serverDir, 'betterCareer')

      // Better Career is an alternative stack to RLS, so clear any stale RLS zips.
      await this.removeStaleRlsZips(clientDir)

      await Promise.all([
        this.downloadFile(clientZipUrl, clientZipPath),
        this.downloadFile(serverZipUrl, serverZipPath)
      ])

      // Release server zip can be nested; stage-extract it and copy only the
      // resolved server payload into Resources/Server.
      const installedServerFiles = await this.deployNestedServerZip(serverZipPath, serverDir)

      await this.removeStaleCareerMpClientZips(clientDir)
      const finalClientPath = join(clientDir, 'CareerMP.zip')
      await copyFile(clientZipPath, finalClientPath)

      const installedFiles = [...installedServerFiles, finalClientPath]
      await this.saveInstalledVersion(serverDir, 'careerMP', {
        version: `${version} (Better Career compat)`,
        installedAt: new Date().toISOString(),
        installedFiles,
        variant: 'betterCareer'
      })
      await this.saveInstalledVersion(serverDir, 'betterCareer', {
        version,
        installedAt: new Date().toISOString(),
        installedFiles
      })
      await this.clearInstalledVersion(serverDir, 'rls')

      await rm(clientZipPath, { force: true }).catch(() => {})
      await rm(serverZipPath, { force: true }).catch(() => {})

      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  async installRLSGreatRebalance(
    careerMpDownloadUrl: string,
    careerMpVersion: string,
    rlsDownloadUrl: string,
    rlsVersion: string,
    patchDownloadUrl: string,
    patchVersion: string,
    serverDir: string
  ): Promise<{ success: boolean; error?: string }> {
    const workDir = join(this.tmpDir, `grb-build-${Date.now()}`)
    const originalsDir = join(workDir, 'originals')
    const outDir = join(workDir, 'built')

    try {
      await mkdir(originalsDir, { recursive: true })
      await mkdir(outDir, { recursive: true })

      // CareerMP GitHub releases contain ONLY the server-side plugin zip
      // (Resources/Server/CareerMP/careerMP.lua).  The BeamNG client mod zip
      // (lua/ge/extensions/, ui/, scripts/, etc.) is a separate artefact that
      // lives at https://raw.githubusercontent.com/StanleyDudek/CareerMP/main/
      // Resources/Client/CareerMP.zip.  build_release.py needs the CLIENT zip
      // as --careermp-original; extracting to the server root needs the SERVER
      // zip.  Using the server zip as build input was the root cause of
      // lua/ge/extensions/careerMPEnabler.lua ending up at the server root.
      const CAREERMP_RAW_CLIENT_URL =
        'https://raw.githubusercontent.com/StanleyDudek/CareerMP/main/Resources/Client/CareerMP.zip'

      const careerMpServerZip = join(originalsDir, `CareerMP_server_${careerMpVersion}.zip`)
      const careerMpClientZip = join(originalsDir, 'CareerMP_client.zip')
      const rlsZip = join(originalsDir, `rls_${rlsVersion}.zip`)
      const patchRepoZip = join(workDir, 'patch-repo.zip')
      const patchExtractDir = join(workDir, 'patch-repo')

      // Download all four inputs in parallel.
      await Promise.all([
        this.downloadFile(careerMpDownloadUrl, careerMpServerZip),
        this.downloadFile(CAREERMP_RAW_CLIENT_URL, careerMpClientZip),
        this.downloadFile(rlsDownloadUrl, rlsZip),
        this.downloadFile(patchDownloadUrl, patchRepoZip),
      ])
      await this.extractZipToDir(patchRepoZip, patchExtractDir)

      const buildScript = await this.findFileByName(patchExtractDir, 'build_release.py')
      if (!buildScript) {
        return { success: false, error: 'Unable to locate build_release.py in the compatibility patch package.' }
      }

      const buildArgs = [
        buildScript,
        '--rls-original',
        rlsZip,
        '--careermp-original',
        careerMpClientZip,   // <-- client mod zip, not the server zip
        '--out-dir',
        outDir
      ]

      const buildWithPython = await this.tryRunPythonBuilder(buildArgs)
      if (!buildWithPython.success) {
        return { success: false, error: buildWithPython.error }
      }

      const builtCareerMpPath = join(outDir, 'CareerMP.zip')
      const builtEntries = await readdir(outDir)
      const builtRlsName = builtEntries.find((n) => /careermp_compatible\.zip$/i.test(n))
      if (!builtRlsName) {
        return { success: false, error: 'Builder finished but no compatible RLS zip was generated.' }
      }
      const builtRlsPath = join(outDir, builtRlsName)

      // 1. Extract ONLY careerMP.lua from the server zip into the correct server
      //    plugin directory.  Never call extractZipToDir on the server zip because
      //    different CareerMP release versions have had inconsistent zip layouts
      //    and any surprise entries would pollute the server root.
      await this.removePreviouslyInstalledFiles(serverDir, 'careerMP')
      const serverPluginDir = join(serverDir, 'Resources', 'Server', 'CareerMP')
      await mkdir(serverPluginDir, { recursive: true })
      const serverCareerMpLuaPath = join(serverPluginDir, 'careerMP.lua')
      await this.extractSingleFileFromZip(careerMpServerZip, 'Resources/Server/CareerMP/careerMP.lua', serverCareerMpLuaPath)

      // 2. Place the Chiarello-patched CLIENT zip at Resources/Client/CareerMP.zip.
      //    This is what BeamMP distributes to connecting players.  Do NOT extract
      //    this zip to the server root (it is a BeamNG mod archive, not a plugin).
      const { copyFile } = await import('node:fs/promises')
      const clientCareerMpPath = join(serverDir, 'Resources', 'Client', 'CareerMP.zip')
      await mkdir(join(serverDir, 'Resources', 'Client'), { recursive: true })
      await copyFile(builtCareerMpPath, clientCareerMpPath)
      await this.saveInstalledVersion(serverDir, 'careerMP', {
        version: `${careerMpVersion} (GRB patched: ${patchVersion})`,
        installedAt: new Date().toISOString(),
        installedFiles: [serverCareerMpLuaPath, clientCareerMpPath],
        variant: 'rls-tgr'
      })

      // Install generated compatible RLS zip to Resources/Client with robust cleanup.
      // clientDir and copyFile are already available from the CareerMP step above.
      const clientDir = join(serverDir, 'Resources', 'Client')
      await this.removeStaleRlsZips(clientDir)

      const finalRlsName = basename(builtRlsPath)
      const finalRlsPath = join(clientDir, finalRlsName)
      await copyFile(builtRlsPath, finalRlsPath)
      await this.saveInstalledVersion(serverDir, 'rls', {
        version: `${rlsVersion} (GRB compatible: ${patchVersion})`,
        traffic: true,
        installedAt: new Date().toISOString(),
        installedFile: finalRlsPath,
        variant: 'rls-tgr'
      })

      // Disable CareerMP auto-update so it doesn't overwrite the patched client zip
      // when the server restarts.  Resources/Server/CareerMP/ was just created by
      // extracting the original CareerMP release zip, so the config directory is safe
      // to write.  Fail the whole install if this step fails — a silently running
      // auto-update would undo all of the patching work above.
      const { readFile: readFileFs, writeFile: writeFileFs } = await import('node:fs/promises')
      const autoUpdateConfigPath = join(
        serverDir,
        'Resources',
        'Server',
        'CareerMP',
        'config',
        'config.json'
      )
      let cfg: Record<string, unknown> = {}
      try {
        const raw = await readFileFs(autoUpdateConfigPath, 'utf-8')
        cfg = JSON.parse(raw) as Record<string, unknown>
      } catch {
        // Config doesn't exist yet — create a minimal one.
      }
      if (typeof cfg.server !== 'object' || cfg.server === null) cfg.server = {}
      ;(cfg.server as Record<string, unknown>).autoUpdate = false
      await mkdir(join(serverDir, 'Resources', 'Server', 'CareerMP', 'config'), { recursive: true })
      await writeFileFs(autoUpdateConfigPath, JSON.stringify(cfg, null, 2), 'utf-8')

      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async getPythonRuntimeStatus(): Promise<{
    available: boolean
    command?: 'python' | 'py'
    version?: string
    canAutoInstall: boolean
    message?: string
  }> {
    const pythonProbe = await this.runProcess('python', ['--version'])
    if (pythonProbe.code === 0) {
      return {
        available: true,
        command: 'python',
        version: (pythonProbe.stdout || pythonProbe.stderr).trim(),
        canAutoInstall: process.platform === 'win32'
      }
    }

    const pyProbe = await this.runProcess('py', ['--version'])
    if (pyProbe.code === 0) {
      return {
        available: true,
        command: 'py',
        version: (pyProbe.stdout || pyProbe.stderr).trim(),
        canAutoInstall: process.platform === 'win32'
      }
    }

    return {
      available: false,
      canAutoInstall: process.platform === 'win32',
      message: 'Python 3 runtime was not detected (checked both python and py commands).'
    }
  }

  async installPythonRuntime(): Promise<{ success: boolean; error?: string }> {
    if (process.platform !== 'win32') {
      return {
        success: false,
        error: 'Automatic Python install is currently only supported on Windows. Please install Python 3 manually.'
      }
    }

    const wingetProbe = await this.runProcess('winget', ['--version'])
    if (wingetProbe.code !== 0) {
      return {
        success: false,
        error:
          'winget is not available on this system. Install Python 3 manually from https://www.python.org/downloads/ and relaunch BeamCM.'
      }
    }

    const install = await this.runProcess('winget', [
      'install',
      '--id', 'Python.Python.3.12',
      '-e',
      '--accept-package-agreements',
      '--accept-source-agreements'
    ])

    if (install.code !== 0) {
      return {
        success: false,
        error: install.stderr || install.stdout || 'winget Python install failed.'
      }
    }

    const post = await this.getPythonRuntimeStatus()
    if (!post.available) {
      return {
        success: false,
        error:
          'Python install finished but Python is still not detectable in the current process. Please restart BeamCM and try again.'
      }
    }

    return { success: true }
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

  /**
   * Read the per-server `career-mods.json` and validate every tracked entry
   * against disk.  An entry is considered installed only when **all** of its
   * tracked files still exist; if any are missing (e.g. the user wiped
   * Resources/ manually) the entry is dropped from the in-memory result AND
   * persisted back to disk so the tracking JSON stops claiming the mod is
   * installed.  Without this round-trip the UI would happily report stale
   * state forever after a manual deletion.
   */
  async getInstalledMods(serverDir: string): Promise<InstalledCareerMods> {
    const metaPath = join(serverDir, 'career-mods.json')
    if (!existsSync(metaPath)) return { careerMP: null, rls: null, betterCareer: null }
    let parsedRaw: Partial<InstalledCareerMods>
    try {
      parsedRaw = JSON.parse(await readFile(metaPath, 'utf-8')) as Partial<InstalledCareerMods>
    } catch {
      return { careerMP: null, rls: null, betterCareer: null }
    }

    const parsed: InstalledCareerMods = {
      careerMP: parsedRaw.careerMP ?? null,
      rls: parsedRaw.rls ?? null,
      betterCareer: parsedRaw.betterCareer ?? null
    }

    let mutated = false

    // CareerMP: require every tracked file to be present.  Some installs
    // (CareerMP server-only release) ship a single file; others (Better
    // Career, GRB) ship a bundle.  If even one file is missing the install
    // is considered broken / partially deleted and we mark it uninstalled.
    const careerMP = parsed.careerMP
    if (careerMP) {
      const files = (careerMP as { installedFiles?: string[] }).installedFiles
      if (!files || files.length === 0 || !files.every((f) => existsSync(f))) {
        parsed.careerMP = null
        mutated = true
      }
    }

    const rls = parsed.rls
    if (rls) {
      const file = (rls as { installedFile?: string }).installedFile
      if (!file || !existsSync(file)) {
        parsed.rls = null
        mutated = true
      }
    }

    const betterCareer = parsed.betterCareer
    if (betterCareer) {
      const files = (betterCareer as { installedFiles?: string[] }).installedFiles
      if (!files || files.length === 0 || !files.every((f) => existsSync(f))) {
        parsed.betterCareer = null
        mutated = true
      }
    }

    // Legacy migration: tracking files written before the `variant` tag was
    // introduced will have `variant === undefined`.  Infer the variant from
    // sibling entries / version strings so the UI lights up the correct card
    // without forcing a reinstall:
    //   - betterCareer entry present  → CareerMP was installed by the BC flow
    //   - rls.version contains "compatible" AND careerMP present → RLS-TGR
    //   - rls entry present (no compat marker) → plain RLS
    //   - careerMP only → plain
    if (parsed.careerMP && parsed.careerMP.variant === undefined) {
      let inferred: CareerMPVariant = 'plain'
      if (parsed.betterCareer) inferred = 'betterCareer'
      else if (parsed.rls && /compatible/i.test(parsed.rls.version)) inferred = 'rls-tgr'
      else if (parsed.rls) inferred = 'rls'
      parsed.careerMP = { ...parsed.careerMP, variant: inferred }
      mutated = true
    }
    if (parsed.rls && parsed.rls.variant === undefined) {
      const inferred: CareerMPVariant = /compatible/i.test(parsed.rls.version) ? 'rls-tgr' : 'rls'
      parsed.rls = { ...parsed.rls, variant: inferred }
      mutated = true
    }

    if (mutated) {
      // Best-effort persist; never let a write failure poison the read path.
      try {
        await writeFile(
          metaPath,
          JSON.stringify(
            { careerMP: parsed.careerMP, rls: parsed.rls, betterCareer: parsed.betterCareer },
            null,
            2
          ),
          'utf-8'
        )
      } catch { /* ignore */ }
    }

    return parsed
  }

  /* ── Uninstall ── */

  /**
   * Uninstall the CareerMP server plugin (and any tracked client zip placed
   * by the plain CareerMP install path).  Does NOT touch RLS or Better
   * Career — call those uninstallers separately if you want to wipe the
   * whole stack.  Safe to call when nothing is installed.
   */
  async uninstallCareerMP(serverDir: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.removePreviouslyInstalledFiles(serverDir, 'careerMP')
      await this.clearInstalledVersion(serverDir, 'careerMP')
      // If Better Career was tracked alongside CareerMP its files share the
      // same on-disk artefacts; clear that key too so the UI doesn't keep
      // pretending Better Career is installed after the underlying files
      // were deleted.
      const installed = await this.getInstalledMods(serverDir)
      if (installed.betterCareer) {
        await this.clearInstalledVersion(serverDir, 'betterCareer')
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  async uninstallRLS(serverDir: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.removePreviouslyInstalledFiles(serverDir, 'rls')
      // Defensive: nuke any leftover RLS-style zip in Resources/Client, in
      // case a previous install path tracked a different filename or the
      // user dropped a stray zip in.
      const clientDir = join(serverDir, 'Resources', 'Client')
      await this.removeStaleRlsZips(clientDir)
      await this.clearInstalledVersion(serverDir, 'rls')
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  /**
   * Better Career install records the same `installedFiles` under both the
   * `careerMP` and `betterCareer` keys, so removing them once and clearing
   * both keys is enough.
   */
  async uninstallBetterCareer(serverDir: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.removePreviouslyInstalledFiles(serverDir, 'betterCareer')
      await this.clearInstalledVersion(serverDir, 'betterCareer')
      await this.clearInstalledVersion(serverDir, 'careerMP')
      // Better Career also drops a stale CareerMP client zip variant; clear
      // that filename too for good measure.
      const clientDir = join(serverDir, 'Resources', 'Client')
      await this.removeStaleCareerMpClientZips(clientDir)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  /**
   * Uninstall the full RLS-TGR (Great Rebalance) stack: CareerMP-patched
   * server lua + client zip, the compatible RLS zip, and the CareerMP
   * Banking server plugin (which is tracked separately in
   * `career-plugins.json`).
   */
  async uninstallRLSGreatRebalance(
    serverDir: string,
    pluginService: { uninstallPlugin: (pluginId: string, serverDir: string) => Promise<{ success: boolean; error?: string }> }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const errors: string[] = []
      const banking = await pluginService.uninstallPlugin('careermp-banking', serverDir)
      if (!banking.success && banking.error) errors.push(`careermp-banking: ${banking.error}`)
      const rls = await this.uninstallRLS(serverDir)
      if (!rls.success && rls.error) errors.push(`rls: ${rls.error}`)
      const cmp = await this.uninstallCareerMP(serverDir)
      if (!cmp.success && cmp.error) errors.push(`careerMP: ${cmp.error}`)
      if (errors.length > 0) return { success: false, error: errors.join('\n') }
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  /* ── Internals ── */

  private async saveInstalledVersion(
    serverDir: string,
    key: 'careerMP' | 'rls' | 'betterCareer',
    data: Record<string, unknown>
  ): Promise<void> {
    const metaPath = join(serverDir, 'career-mods.json')
    let existing: Record<string, unknown> = { careerMP: null, rls: null, betterCareer: null }
    if (existsSync(metaPath)) {
      try { existing = JSON.parse(await readFile(metaPath, 'utf-8')) } catch { /* */ }
    }
    existing[key] = data
    await writeFile(metaPath, JSON.stringify(existing, null, 2), 'utf-8')
  }

  private async clearInstalledVersion(
    serverDir: string,
    key: 'careerMP' | 'rls' | 'betterCareer'
  ): Promise<void> {
    const metaPath = join(serverDir, 'career-mods.json')
    let existing: Record<string, unknown> = { careerMP: null, rls: null, betterCareer: null }
    if (existsSync(metaPath)) {
      try { existing = JSON.parse(await readFile(metaPath, 'utf-8')) } catch { /* */ }
    }
    existing[key] = null
    await writeFile(metaPath, JSON.stringify(existing, null, 2), 'utf-8')
  }

  /**
   * Extract exactly one file from a zip by its in-archive path and write it to
   * `destPath`.  Throws if the entry is not found.
   */
  private extractSingleFileFromZip(zipPath: string, entryName: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
        if (err || !zipFile) { reject(err ?? new Error('Failed to open zip')); return }
        let found = false
        zipFile.readEntry()
        zipFile.on('entry', (entry: Entry) => {
          const normalized = entry.fileName.replace(/\\/g, '/')
          if (normalized === entryName) {
            found = true
            zipFile.openReadStream(entry, (sErr, stream) => {
              if (sErr || !stream) { zipFile.close(); reject(sErr ?? new Error('Failed to read entry')); return }
              const ws = createWriteStream(destPath)
              stream.pipe(ws)
              ws.on('finish', () => { ws.close(); zipFile.close(); resolve() })
              ws.on('error', (e) => { zipFile.close(); reject(e) })
            })
          } else {
            zipFile.readEntry()
          }
        })
        zipFile.on('end', () => {
          if (!found) reject(new Error(`Entry '${entryName}' not found in ${zipPath}`))
        })
        zipFile.on('error', (e) => reject(e))
      })
    })
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
   * Delete every RLS-related zip currently sitting in
   * the server's `Resources/Client` directory. Called immediately before
   * deploying a fresh RLS zip so version switches don't leave the previous
   * version's client zip behind for the BeamMP launcher to also serve.
   */
  private async removeStaleRlsZips(clientDir: string): Promise<void> {
    if (!existsSync(clientDir)) return
    try {
      const entries = await readdir(clientDir)
      for (const name of entries) {
        // Covers legacy names (RLS_*.zip), newer overhaul names, and
        // generated compatibility outputs that can change across updates.
        if (/\.zip$/i.test(name) && /(rls|career_overhaul)/i.test(name)) {
          await rm(join(clientDir, name), { force: true }).catch(() => {})
        }
      }
    } catch { /* ignore */ }
  }

  private async removeStaleCareerMpClientZips(clientDir: string): Promise<void> {
    if (!existsSync(clientDir)) return
    const staleNames = new Set(['careermp.zip', 'careermp_bettercareer.zip'])
    try {
      const entries = await readdir(clientDir)
      for (const name of entries) {
        if (staleNames.has(name.toLowerCase())) {
          await rm(join(clientDir, name), { force: true }).catch(() => {})
        }
      }
    } catch { /* ignore */ }
  }

  private async deployNestedServerZip(zipPath: string, serverDir: string): Promise<string[]> {
    const stageDir = join(this.tmpDir, `better-career-server-stage-${Date.now()}`)
    try {
      await mkdir(stageDir, { recursive: true })
      await this.extractZipToDir(zipPath, stageDir)

      const payloadRoot = await this.findServerPayloadRoot(stageDir)
      if (!payloadRoot) {
        throw new Error('Could not find Resources/Server or Server payload in Better Career server package.')
      }

      const fromResourcesServer = join(payloadRoot, 'Resources', 'Server')
      const fromServer = join(payloadRoot, 'Server')
      const sourceServerDir = existsSync(fromResourcesServer) ? fromResourcesServer : fromServer
      if (!existsSync(sourceServerDir)) {
        throw new Error('Better Career server package payload is missing Server files.')
      }

      const targetServerDir = join(serverDir, 'Resources', 'Server')
      await mkdir(targetServerDir, { recursive: true })
      return this.copyDirectory(sourceServerDir, targetServerDir)
    } finally {
      await rm(stageDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async findServerPayloadRoot(root: string): Promise<string | null> {
    if (existsSync(join(root, 'Resources', 'Server')) || existsSync(join(root, 'Server'))) return root

    const stack: string[] = [root]
    while (stack.length > 0) {
      const cur = stack.pop() as string
      let entries: Array<{ name: string; isDirectory: () => boolean }> = []
      try {
        entries = await readdir(cur, { withFileTypes: true })
      } catch {
        continue
      }
      if (existsSync(join(cur, 'Resources', 'Server')) || existsSync(join(cur, 'Server'))) return cur
      for (const entry of entries) {
        if (entry.isDirectory()) stack.push(join(cur, entry.name))
      }
    }
    return null
  }

  private async copyDirectory(fromDir: string, toDir: string): Promise<string[]> {
    await mkdir(toDir, { recursive: true })
    const copied: string[] = []
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
      entries = await readdir(fromDir, { withFileTypes: true })
    } catch (err) {
      // Some package manifests reference directories that are not materialized
      // in the extracted tree; treat as optional and continue.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return copied
      throw err
    }
    for (const entry of entries) {
      const fromPath = join(fromDir, entry.name)
      const toPath = join(toDir, entry.name)
      if (entry.isDirectory()) {
        try {
          const nested = await this.copyDirectory(fromPath, toPath)
          copied.push(...nested)
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
        }
      } else if (entry.isFile()) {
        await mkdir(dirname(toPath), { recursive: true })
        try {
          await copyFile(fromPath, toPath)
          copied.push(toPath)
        } catch (err) {
          // Some generated compatibility packages can contain unstable file
          // entries that are listed but not materialized after extraction.
          // Skip missing source files instead of failing the whole install.
          if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
        }
      }
    }
    return copied
  }

  private async findFileByName(root: string, fileName: string): Promise<string | null> {
    const stack: string[] = [root]
    while (stack.length > 0) {
      const current = stack.pop() as string
      const entries = await readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(current, entry.name)
        if (entry.isDirectory()) {
          stack.push(full)
          continue
        }
        if (entry.isFile() && entry.name === fileName) return full
      }
    }
    return null
  }

  private async tryRunPythonBuilder(args: string[]): Promise<{ success: boolean; error?: string }> {
    const attempts: Array<{ cmd: string; args: string[] }> = [
      { cmd: 'python', args },
      { cmd: 'py', args }
    ]

    const errors: string[] = []
    for (const attempt of attempts) {
      const result = await this.runProcess(attempt.cmd, attempt.args)
      if (result.code === 0) return { success: true }
      errors.push(`${attempt.cmd}: ${result.stderr || result.stdout || `exit code ${String(result.code)}`}`)
    }

    return {
      success: false,
      error:
        'PYTHON_MISSING: Failed to run compatibility builder. Install Python 3 (or py launcher) and try again.\n' +
        errors.join('\n')
    }
  }

  private runProcess(command: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { windowsHide: true })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => { stdout += d.toString() })
      child.stderr.on('data', (d) => { stderr += d.toString() })
      child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err) }))
      child.on('close', (code) => resolve({ code, stdout, stderr }))
    })
  }

  /**
   * Remove the exact set of files placed by the previous install of `key`
   * (CareerMP / RLS) as recorded in `career-mods.json`. After deleting files,
   * walks parent directories bottom-up and removes any that are now empty.
   * Silently no-ops if no prior install was tracked.
   */
  private async removePreviouslyInstalledFiles(
    serverDir: string,
    key: 'careerMP' | 'rls' | 'betterCareer'
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
