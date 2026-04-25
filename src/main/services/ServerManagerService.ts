import { readFile, writeFile, mkdir, readdir, unlink, stat, copyFile, rm, chmod, rename, cp } from 'fs/promises'
import { existsSync, createWriteStream } from 'fs'
import { join, basename, dirname, relative, sep, posix } from 'path'
import { app, BrowserWindow, safeStorage } from 'electron'
import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AnalyticsService } from './AnalyticsService'
import { spawn, ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { get as httpsGet } from 'https'
import { totalmem } from 'os'
import pidusage from 'pidusage'
import { open as yauzlOpen, type Entry } from 'yauzl'
import archiver from 'archiver'
import { isModArchive, stripArchiveExt } from '../utils/archiveConverter'
import type {
  HostedServerConfig,
  HostedServerStatus,
  HostedServerState,
  HostedServerEntry,
  ServerFileEntry,
  ServerFileSearchResult,
  GPSRoute,
  PlayerPosition,
  SupportTicket,
  SupportTicketStatus,
  SupportTicketCreateInput,
  SupportTicketUpdateInput,
  HostedServerSupportIngestConfig,
  HostedServerSupportTicketUiConfig,
  HostedServerSupportIngestStatus,
} from '../../shared/types'

const DEFAULT_CONFIG: Omit<HostedServerConfig, 'id'> = {
  name: 'My BeamMP Server',
  port: 30814,
  authKey: '',
  maxPlayers: 8,
  maxCars: 1,
  map: '/levels/gridmap_v2/info.json',
  private: true,
  description: '',
  resourceFolder: 'Resources',
  tags: 'Freeroam',
  allowGuests: true,
  logChat: true,
  debug: false,
  clientContentGate: false
}

interface RunningServer {
  process: ChildProcess
  state: HostedServerState
  startedAt: number
  players: number
  error: string | null
  consoleBuffer: string[]
  memoryBytes: number
  cpuPercent: number
  resourceTimer: ReturnType<typeof setInterval> | null
  connectionPollTimer: ReturnType<typeof setInterval> | null
  analyticsPollerTimer: ReturnType<typeof setInterval> | null
}

interface RunningSupportIngest {
  server: HttpServer
  port: number
  token: string
}

interface ModGateConfigFile {
  enabled: boolean
  allowedArchives: string[]
  allowedVehicleNames: string[]
  stockVehicleNames: string[]
  serverVehicleNames: string[]
  vehicleDisplayNames?: Record<string, string>
  vehicleDeniedNames: string[]
  vehicleForcedAllowedNames: string[]
  updatedAt: string
}

interface SaveModGateConfigInput {
  allowedVehicleNames?: string[]
}

const MAX_CONSOLE_LINES = 2000
const POSITION_RETENTION_MS = 30 * 60 * 1000
// How long a position entry is considered live (tracker writes every 500ms, so 5s gives 10x margin)
const POSITION_STALE_WINDOW_SEC = 5
// How long to serve cached positions when the file can't be read (bridges transient write gaps)
const POSITION_ERROR_CACHE_MS = 3000

/**
 * Parse a port specification string (e.g. "30814,30816-30820,31000") into an
 * array of individual port numbers, sorted ascending.
 */
export function parsePortSpec(spec: string): number[] {
  if (!spec || !spec.trim()) return []
  const ports = new Set<number>()
  for (const part of spec.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/)
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10)
      const hi = parseInt(rangeMatch[2], 10)
      if (lo >= 1 && hi <= 65535 && lo <= hi) {
        for (let p = lo; p <= hi; p++) ports.add(p)
      }
    } else {
      const p = parseInt(trimmed, 10)
      if (p >= 1 && p <= 65535) ports.add(p)
    }
  }
  return [...ports].sort((a, b) => a - b)
}

export class ServerManagerService {
  private serversDir: string
  private binDir: string
  private running = new Map<string, RunningServer>()
  private lastGoodPositions = new Map<string, { positions: PlayerPosition[]; updatedAtMs: number }>()
  private exePath: string | null = null
  private downloading = false
  private customExeResolver: (() => string | null) | null = null
  private installDirResolver: (() => string | null) | null = null
  private onServerStartCallback: ((id: string, serverDir: string, resourceFolder: string) => void) | null = null
  private analyticsService: AnalyticsService | null = null
  private supportIngest = new Map<string, RunningSupportIngest>()

  constructor() {
    const base = join(app.getPath('appData'), 'BeamMP-ContentManager')
    this.serversDir = join(base, 'servers')
    this.binDir = join(base, 'bin')
  }

  /** Set a callback that returns the custom server exe path from config (or null for default) */
  setCustomExeResolver(resolver: () => string | null): void {
    this.customExeResolver = resolver
  }

  /** Resolve BeamNG install directory from app config when needed. */
  setInstallDirResolver(resolver: () => string | null): void {
    this.installDirResolver = resolver
  }

  /** Inject the analytics service so the server manager can update player sessions directly */
  setAnalyticsService(svc: AnalyticsService): void {
    this.analyticsService = svc
  }

  /**
   * Set a callback fired right after a managed server process spawns. Used by
   * the IPC layer to lazily inject per-server payloads (e.g. the voice chat
   * plugin) only into servers that are actually being run, so unrun server
   * folders stay clean.
   */
  setOnServerStart(cb: (id: string, serverDir: string, resourceFolder: string) => void): void {
    this.onServerStartCallback = cb
  }

  /** Resolve the effective exe path: custom override > built-in managed copy */
  private resolveExePath(): string | null {
    const custom = this.customExeResolver?.()
    if (custom && existsSync(custom)) return custom
    return this.exePath
  }

  private async pollConnectionCount(port: number): Promise<number> {
    try {
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execPromise = promisify(exec)

      let cmd: string
      if (process.platform === 'win32') {
        // On Windows, use netstat to count ESTABLISHED connections on the port
        cmd = `netstat -an | find "${port}" | find "ESTABLISHED" /c`
      } else {
        // On Linux/macOS, use ss or netstat
        cmd = `ss -tuln 2>/dev/null | grep ":${port}" | wc -l || netstat -tuln 2>/dev/null | grep ":${port}" | wc -l || echo 0`
      }

      const { stdout } = await execPromise(cmd, { windowsHide: true })
      const count = parseInt(stdout.trim().split('\n')[0], 10) || 0
      // Subtract 1 for the listening socket itself on some netstat outputs
      return Math.max(0, count - 1)
    } catch {
      return 0
    }
  }

  /* ── Auth Key encryption helpers ── */

  private encryptAuthKey(plainKey: string): string {
    if (!plainKey || !safeStorage.isEncryptionAvailable()) return plainKey
    try {
      return 'enc:' + safeStorage.encryptString(plainKey).toString('base64')
    } catch {
      return plainKey
    }
  }

  private decryptAuthKey(stored: string): string {
    if (!stored || !stored.startsWith('enc:')) return stored
    if (!safeStorage.isEncryptionAvailable()) return ''
    try {
      const buf = Buffer.from(stored.slice(4), 'base64')
      return safeStorage.decryptString(buf)
    } catch {
      return ''
    }
  }

  /** Serialize config to JSON for server.json — encrypts authKey */
  private serializeConfig(config: HostedServerConfig): string {
    const toStore = { ...config, authKey: this.encryptAuthKey(config.authKey) }
    return JSON.stringify(toStore, null, 2)
  }

  /** Deserialize config from server.json — decrypts authKey */
  private deserializeConfig(raw: string): HostedServerConfig {
    const config: HostedServerConfig = JSON.parse(raw)
    config.authKey = this.decryptAuthKey(config.authKey)
    return config
  }

  /* ── EXE Management ── */

  private get exeName(): string {
    return process.platform === 'win32' ? 'BeamMP-Server.exe' : 'BeamMP-Server'
  }

  /** On Linux/Mac, mark a binary as executable */
  private async makeExecutable(filePath: string): Promise<void> {
    if (process.platform !== 'win32') {
      await chmod(filePath, 0o755)
    }
  }

  private serverExePath(id: string): string {
    return join(this.serversDir, id, this.exeName)
  }

  async init(): Promise<void> {
    await this.ensureDir()
    if (!existsSync(this.binDir)) await mkdir(this.binDir, { recursive: true })
    const candidate = join(this.binDir, this.exeName)
    if (existsSync(candidate)) {
      this.exePath = candidate
      await this.distributeExe()
    }
  }

  setExePath(exePath: string): void {
    this.exePath = exePath
  }

  getExePath(): string | null {
    return this.exePath
  }

  isDownloading(): boolean {
    return this.downloading
  }

  getExeStatus(): 'ready' | 'missing' | 'downloading' {
    if (this.downloading) return 'downloading'
    const effective = this.resolveExePath()
    if (effective && existsSync(effective)) return 'ready'
    return 'missing'
  }

  async installExeFromPath(sourcePath: string): Promise<string> {
    if (!existsSync(this.binDir)) await mkdir(this.binDir, { recursive: true })
    const dest = join(this.binDir, this.exeName)
    await copyFile(sourcePath, dest)
    await this.makeExecutable(dest)
    this.exePath = dest
    await this.distributeExe()
    return dest
  }

  /** Copy the source exe into every server directory (skips running servers) */
  private async distributeExe(): Promise<void> {
    if (!this.exePath || !existsSync(this.exePath)) return
    const dirs = await readdir(this.serversDir, { withFileTypes: true }).catch(() => [])
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      const cfgPath = join(this.serversDir, d.name, 'server.json')
      if (!existsSync(cfgPath)) continue
      if (this.running.has(d.name)) continue // skip servers that are currently running
      const dest = this.serverExePath(d.name)
      await copyFile(this.exePath, dest)
      await this.makeExecutable(dest)
    }
  }

  async downloadExe(): Promise<{ success: boolean; error?: string }> {
    if (this.downloading) return { success: false, error: 'Already downloading' }
    this.downloading = true
    this.emitExeStatus()
    try {
      const releasesUrl = 'https://api.github.com/repos/BeamMP/BeamMP-Server/releases/latest'
      const release = await this.fetchJson(releasesUrl) as { assets: { name: string; browser_download_url: string }[] }
      const isWin = process.platform === 'win32'
      const asset = release.assets.find((a: { name: string }) =>
        isWin ? a.name.endsWith('.exe') : a.name.includes('linux')
      )
      if (!asset) return { success: false, error: 'No matching asset found for this platform' }

      if (!existsSync(this.binDir)) await mkdir(this.binDir, { recursive: true })
      const dest = join(this.binDir, this.exeName)

      await this.downloadFile(asset.browser_download_url, dest)
      await this.makeExecutable(dest)
      this.exePath = dest
      await this.distributeExe()
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message }
    } finally {
      this.downloading = false
      this.emitExeStatus()
    }
  }

  /* ── File Manager ── */

  async listServerFiles(id: string, subPath: string = ''): Promise<ServerFileEntry[]> {
    const serverDir = join(this.serversDir, id)
    const target = subPath ? join(serverDir, subPath) : serverDir
    if (!existsSync(target)) return []
    const entries = await readdir(target, { withFileTypes: true })
    const results: ServerFileEntry[] = []
    for (const e of entries) {
      const full = join(target, e.name)
      const s = await stat(full).catch(() => null)
      results.push({
        name: e.name,
        path: subPath ? `${subPath}/${e.name}` : e.name,
        isDirectory: e.isDirectory(),
        size: s?.size ?? 0,
        modified: s?.mtimeMs ?? 0
      })
    }
    return results.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  async deleteServerFile(id: string, filePath: string): Promise<void> {
    const full = join(this.serversDir, id, filePath)
    const s = await stat(full)
    if (s.isDirectory()) {
      await rm(full, { recursive: true, force: true })
    } else {
      await unlink(full)
    }
  }

  async createServerFolder(id: string, folderPath: string): Promise<void> {
    const full = join(this.serversDir, id, folderPath)
    await mkdir(full, { recursive: true })
  }

  async copyModToServer(id: string, modFilePath: string): Promise<string> {
    const config = await this.getServerConfig(id)
    if (!config) throw new Error('Server not found')
    const serverDir = join(this.serversDir, id)
    const resourceDir = join(serverDir, config.resourceFolder, 'Client')
    if (!existsSync(resourceDir)) await mkdir(resourceDir, { recursive: true })
    const fileName = basename(modFilePath)
    const dest = join(resourceDir, fileName)
    await copyFile(modFilePath, dest)
    return `${config.resourceFolder}/Client/${fileName}`
  }

  async addFileToServer(id: string, sourcePath: string, destSubPath: string): Promise<void> {
    const full = join(this.serversDir, id, destSubPath)
    const dir = join(full, '..')
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await copyFile(sourcePath, full)
  }

  getServerDir(id: string): string {
    return join(this.serversDir, id)
  }

  // ── Deploy map: tracks source mod name → deployed filenames for Resources-layout mods ──

  private deployMapPath(id: string): string {
    return join(this.serversDir, id, 'deploy_map.json')
  }

  async getDeployMap(id: string): Promise<Record<string, string[]>> {
    const p = this.deployMapPath(id)
    if (!existsSync(p)) return {}
    try {
      return JSON.parse(await readFile(p, 'utf-8'))
    } catch {
      return {}
    }
  }

  async setDeployMapping(id: string, sourceFileName: string, deployedFileNames: string[]): Promise<void> {
    const map = await this.getDeployMap(id)
    map[sourceFileName.toLowerCase()] = deployedFileNames.map((n) => n.toLowerCase())
    await writeFile(this.deployMapPath(id), JSON.stringify(map, null, 2))
  }

  async removeDeployMapping(id: string, sourceFileName: string): Promise<void> {
    const map = await this.getDeployMap(id)
    delete map[sourceFileName.toLowerCase()]
    await writeFile(this.deployMapPath(id), JSON.stringify(map, null, 2))
  }

  async getDeployedMods(id: string): Promise<string[]> {
    const config = await this.getServerConfig(id)
    if (!config) return []
    const clientDir = join(this.serversDir, id, config.resourceFolder, 'Client')
    if (!existsSync(clientDir)) return []
    const entries = await readdir(clientDir, { withFileTypes: true })
    const onDisk = new Set(
      entries
        .filter((e) => !e.isDirectory() && isModArchive(e.name))
        .map((e) => e.name.toLowerCase())
    )

    // Include source mod names from the deploy map if their deployed files exist
    const map = await this.getDeployMap(id)
    for (const [source, deployed] of Object.entries(map)) {
      if (deployed.some((f) => onDisk.has(f))) {
        onDisk.add(source)
      }
    }

    return [...onDisk]
  }

  async undeployMod(id: string, modFileName: string): Promise<void> {
    const config = await this.getServerConfig(id)
    if (!config) throw new Error('Server not found')
    const serverDir = join(this.serversDir, id)
    const needle = modFileName.toLowerCase()

    // Check deploy map — if this is a source name, delete the mapped files instead
    const map = await this.getDeployMap(id)
    const mappedFiles = map[needle]
    if (mappedFiles && mappedFiles.length > 0) {
      for (const mf of mappedFiles) {
        const clientZip = join(serverDir, config.resourceFolder, 'Client', mf)
        if (existsSync(clientZip)) await unlink(clientZip)
        const modId = stripArchiveExt(mf)
        const serverPlugin = join(serverDir, config.resourceFolder, 'Server', modId)
        if (existsSync(serverPlugin)) await rm(serverPlugin, { recursive: true, force: true })
      }
      await this.removeDeployMapping(id, needle)
    } else {
      // Direct filename — remove as before
      const clientZip = join(serverDir, config.resourceFolder, 'Client', modFileName)
      if (existsSync(clientZip)) await unlink(clientZip)

      const modId = stripArchiveExt(modFileName)
      const serverPlugin = join(serverDir, config.resourceFolder, 'Server', modId)
      if (existsSync(serverPlugin)) await rm(serverPlugin, { recursive: true, force: true })
    }
  }

  async getServersWithMod(modFileName: string): Promise<Array<{ id: string; name: string }>> {
    const servers = await this.listServers()
    const results: Array<{ id: string; name: string }> = []
    const needle = modFileName.toLowerCase()
    for (const server of servers) {
      const deployed = await this.getDeployedMods(server.config.id)
      if (deployed.includes(needle)) {
        results.push({ id: server.config.id, name: server.config.name })
      }
    }
    return results
  }

  private assertInsideServerDir(id: string, filePath: string): string {
    const serverDir = join(this.serversDir, id)
    const resolved = join(serverDir, filePath)
    const rel = relative(serverDir, resolved)
    if (rel.startsWith('..') || (rel.length > 0 && rel[0] === sep && !rel.startsWith(serverDir))) {
      throw new Error('Access denied: path outside server directory')
    }
    if (!resolved.startsWith(serverDir)) {
      throw new Error('Access denied: path outside server directory')
    }
    return resolved
  }

  /** Returns the absolute path for a server entry (validated). */
  getServerEntryAbsolutePath(id: string, filePath: string): string {
    return this.assertInsideServerDir(id, filePath)
  }

  async renameServerEntry(id: string, oldPath: string, newName: string): Promise<string> {
    const trimmed = newName.trim()
    if (!trimmed) throw new Error('New name is empty')
    if (/[\\/:*?"<>|]/.test(trimmed)) throw new Error('Invalid characters in name')
    const fullOld = this.assertInsideServerDir(id, oldPath)
    const parent = dirname(fullOld)
    const fullNew = join(parent, trimmed)
    // Ensure new path is still inside server dir
    const serverDir = join(this.serversDir, id)
    if (!fullNew.startsWith(serverDir)) throw new Error('Invalid target path')
    if (fullNew === fullOld) return oldPath
    if (existsSync(fullNew)) throw new Error('Target name already exists')
    await rename(fullOld, fullNew)
    const parentRel = relative(serverDir, parent).split(sep).join(posix.sep)
    return parentRel ? `${parentRel}/${trimmed}` : trimmed
  }

  async duplicateServerEntry(id: string, filePath: string): Promise<string> {
    const full = this.assertInsideServerDir(id, filePath)
    const parent = dirname(full)
    const base = basename(full)
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ''
    let candidate = ''
    for (let i = 1; i < 1000; i++) {
      candidate = `${stem} (copy${i === 1 ? '' : ' ' + i})${ext}`
      if (!existsSync(join(parent, candidate))) break
    }
    const dest = join(parent, candidate)
    const s = await stat(full)
    if (s.isDirectory()) {
      await cp(full, dest, { recursive: true })
    } else {
      await copyFile(full, dest)
    }
    const serverDir = join(this.serversDir, id)
    const parentRel = relative(serverDir, parent).split(sep).join(posix.sep)
    return parentRel ? `${parentRel}/${candidate}` : candidate
  }

  /**
   * Zip a file or folder. The output is placed beside the source as <name>.zip
   * (with a numeric suffix if needed). Returns the relative path of the new zip.
   */
  async zipServerEntry(id: string, filePath: string): Promise<string> {
    const full = this.assertInsideServerDir(id, filePath)
    const parent = dirname(full)
    const base = basename(full)
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 && (await stat(full)).isFile() ? base.slice(0, dot) : base
    let candidateName = `${stem}.zip`
    let i = 1
    while (existsSync(join(parent, candidateName))) {
      i++
      candidateName = `${stem} (${i}).zip`
      if (i > 999) throw new Error('Too many existing archives')
    }
    const outAbs = join(parent, candidateName)
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(outAbs)
      const archive = archiver('zip', { zlib: { level: 9 } })
      output.on('close', () => resolve())
      output.on('error', (e) => reject(e))
      archive.on('error', (e) => reject(e))
      archive.pipe(output)
      stat(full).then((s) => {
        if (s.isDirectory()) {
          archive.directory(full, basename(full))
        } else {
          archive.file(full, { name: basename(full) })
        }
        archive.finalize()
      }).catch(reject)
    })
    const serverDir = join(this.serversDir, id)
    const parentRel = relative(serverDir, parent).split(sep).join(posix.sep)
    return parentRel ? `${parentRel}/${candidateName}` : candidateName
  }

  /** Recursively search for entries by name fragment. Limited results. */
  async searchServerFiles(
    id: string,
    subPath: string,
    query: string,
    options: { maxResults?: number; maxDepth?: number } = {}
  ): Promise<ServerFileSearchResult[]> {
    const max = options.maxResults ?? 500
    const maxDepth = options.maxDepth ?? 12
    const q = query.toLowerCase().trim()
    if (!q) return []
    const serverDir = join(this.serversDir, id)
    const root = subPath ? this.assertInsideServerDir(id, subPath) : serverDir
    const results: ServerFileSearchResult[] = []
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (results.length >= max || depth > maxDepth) return
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (results.length >= max) return
        const full = join(dir, e.name)
        const isDir = e.isDirectory()
        if (e.name.toLowerCase().includes(q)) {
          const s = await stat(full).catch(() => null)
          const relPath = relative(serverDir, full).split(sep).join(posix.sep)
          const parentRel = relative(serverDir, dirname(full)).split(sep).join(posix.sep)
          results.push({
            name: e.name,
            path: relPath,
            isDirectory: isDir,
            size: s?.size ?? 0,
            modified: s?.mtimeMs ?? 0,
            parentPath: parentRel
          })
        }
        if (isDir) {
          await walk(full, depth + 1)
        }
      }
    }
    await walk(root, 0)
    return results
  }

  /** Copy a server file/folder to an arbitrary external destination. */
  async downloadServerEntry(id: string, filePath: string, destAbsolute: string): Promise<void> {
    const full = this.assertInsideServerDir(id, filePath)
    const s = await stat(full)
    if (s.isDirectory()) {
      await cp(full, destAbsolute, { recursive: true })
    } else {
      await mkdir(dirname(destAbsolute), { recursive: true })
      await copyFile(full, destAbsolute)
    }
  }

  async readServerFile(id: string, filePath: string): Promise<string> {
    const full = this.assertInsideServerDir(id, filePath)
    return readFile(full, 'utf-8')
  }

  async writeServerFile(id: string, filePath: string, content: string): Promise<void> {
    const full = this.assertInsideServerDir(id, filePath)
    await writeFile(full, content, 'utf-8')
  }

  async extractZip(id: string, zipPath: string): Promise<number> {
    const full = this.assertInsideServerDir(id, zipPath)
    const destDir = dirname(full)

    return new Promise((resolve, reject) => {
      yauzlOpen(full, { lazyEntries: true }, (err, zipFile) => {
        if (err || !zipFile) { reject(err ?? new Error('Failed to open zip')); return }

        let extracted = 0
        zipFile.readEntry()

        zipFile.on('entry', (entry: Entry) => {
          const entryPath = join(destDir, entry.fileName)
          // Path traversal guard
          if (!entryPath.startsWith(destDir)) {
            zipFile.readEntry()
            return
          }

          if (/\/$/.test(entry.fileName)) {
            // Directory entry
            mkdir(entryPath, { recursive: true })
              .then(() => zipFile.readEntry())
              .catch(() => zipFile.readEntry())
          } else {
            // File entry
            mkdir(dirname(entryPath), { recursive: true })
              .then(() => {
                zipFile.openReadStream(entry, (sErr, stream) => {
                  if (sErr || !stream) { zipFile.readEntry(); return }
                  const ws = createWriteStream(entryPath)
                  stream.pipe(ws)
                  ws.on('finish', () => { extracted++; zipFile.readEntry() })
                  ws.on('error', () => zipFile.readEntry())
                })
              })
              .catch(() => zipFile.readEntry())
          }
        })

        zipFile.on('end', () => { zipFile.close(); resolve(extracted) })
        zipFile.on('error', (e) => reject(e))
      })
    })
  }

  /* ── GPS Routes ── */

  async getRoutes(id: string): Promise<GPSRoute[]> {
    const routesPath = join(this.serversDir, id, 'routes.json')
    if (!existsSync(routesPath)) return []
    try {
      const raw = await readFile(routesPath, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return []
    }
  }

  async saveRoute(id: string, route: GPSRoute): Promise<GPSRoute[]> {
    const routes = await this.getRoutes(id)
    const idx = routes.findIndex((r) => r.id === route.id)
    if (idx >= 0) {
      routes[idx] = route
    } else {
      routes.push(route)
    }
    await writeFile(join(this.serversDir, id, 'routes.json'), JSON.stringify(routes, null, 2), 'utf-8')
    return routes
  }

  async deleteRoute(id: string, routeId: string): Promise<GPSRoute[]> {
    const routes = (await this.getRoutes(id)).filter((r) => r.id !== routeId)
    await writeFile(join(this.serversDir, id, 'routes.json'), JSON.stringify(routes, null, 2), 'utf-8')
    return routes
  }

  /* ── Player Positions ── */

  async getPlayerPositions(id: string): Promise<PlayerPosition[]> {
    const cached = this.lastGoodPositions.get(id)
    // Never surface cached/live positions when the server is not running.
    // This avoids showing ghost markers before startup.
    if (!this.running.has(id)) {
      this.lastGoodPositions.delete(id)
      return []
    }

    const posPath = join(this.serversDir, id, 'player_positions.json')
    // Also check the plugin directory — old deployments used a relative path
    // that some BeamMP versions resolve relative to the plugin folder instead of
    // the server root.
    const config = await this.getServerConfig(id).catch(() => null)
    const trackerMainPath = config
      ? join(this.serversDir, id, config.resourceFolder, 'Server', 'BeamMPCM', 'main.lua')
      : null
    // If tracker isn't deployed, treat positions as unavailable so old files
    // cannot keep rendering stale markers/heat.
    if (!trackerMainPath || !existsSync(trackerMainPath)) {
      this.lastGoodPositions.delete(id)
      return []
    }

    const pluginPosPath = config
      ? join(this.serversDir, id, config.resourceFolder, 'Server', 'BeamMPCM', 'player_positions.json')
      : null

    const candidates = [posPath, pluginPosPath].filter((p): p is string => Boolean(p && existsSync(p)))
    if (candidates.length === 0) {
      if (cached && Date.now() - cached.updatedAtMs < POSITION_RETENTION_MS) return cached.positions
      return []
    }

    // Use the freshest file so we don't get stuck reading a stale root file while
    // the tracker is actively writing the fallback plugin path (or vice versa).
    const ranked = await Promise.all(
      candidates.map(async (p) => {
        try {
          const s = await stat(p)
          return { p, mtimeMs: s.mtimeMs }
        } catch {
          return { p, mtimeMs: 0 }
        }
      })
    )
    ranked.sort((a, b) => b.mtimeMs - a.mtimeMs)
    const activePath = ranked[0].p

    try {
      const raw = await readFile(activePath, 'utf-8')
      const parsed: PlayerPosition[] = JSON.parse(raw)
      // Reject very stale entries, but tolerate short write gaps/hiccups so
      // markers don't disappear when navigating between pages.
      const nowSec = Date.now() / 1000
      const fresh = parsed.filter((p) => p.timestamp && nowSec - p.timestamp < POSITION_STALE_WINDOW_SEC)
      if (fresh.length > 0) {
        this.lastGoodPositions.set(id, { positions: fresh, updatedAtMs: Date.now() })
        return fresh
      }
      // File was read and parsed successfully but no fresh positions — the player(s)
      // genuinely disconnected. Clear the cache so ghost markers don't linger.
      this.lastGoodPositions.delete(id)
      return []
    } catch {
      // On read/parse error only: return short-lived cached positions to bridge
      // transient write gaps (e.g. tracker is mid-write when we read the file).
      if (cached && Date.now() - cached.updatedAtMs < POSITION_ERROR_CACHE_MS) return cached.positions
      return []
    }
  }

  /* ── Tracker Plugin Deploy ── */

  async deployTrackerPlugin(id: string): Promise<void> {
    const config = await this.getServerConfig(id)
    if (!config) throw new Error('Server not found')
    const pluginDir = join(this.serversDir, id, config.resourceFolder, 'Server', 'BeamMPCM')
    if (!existsSync(pluginDir)) await mkdir(pluginDir, { recursive: true })
    const pluginPath = join(pluginDir, 'main.lua')
    const serverDir = join(this.serversDir, id)
    await writeFile(pluginPath, buildTrackerLuaPlugin(serverDir), 'utf-8')
  }

  async isTrackerPluginDeployed(id: string): Promise<boolean> {
    const config = await this.getServerConfig(id)
    if (!config) return false
    const pluginPath = join(this.serversDir, id, config.resourceFolder, 'Server', 'BeamMPCM', 'main.lua')
    return existsSync(pluginPath)
  }

  async undeployTrackerPlugin(id: string): Promise<void> {
    const config = await this.getServerConfig(id)
    if (!config) throw new Error('Server not found')
    const pluginDir = join(this.serversDir, id, config.resourceFolder, 'Server', 'BeamMPCM')
    if (existsSync(pluginDir)) {
      await rm(pluginDir, { recursive: true, force: true })
    }
  }

  /* ── Client Content Gate (sideloaded vehicle spawn blocker) ── */

  private async listClientArchives(serverDir: string, resourceFolder: string): Promise<string[]> {
    const clientDir = join(serverDir, resourceFolder, 'Client')
    if (!existsSync(clientDir)) return []
    const files = await readdir(clientDir, { withFileTypes: true }).catch(() => [])
    return files
      .filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.zip'))
      .map((f) => f.name.toLowerCase())
      .sort((a, b) => a.localeCompare(b))
  }

  /** Discover vehicle ids + display names inside a zip by scanning vehicle metadata entries. */
  private discoverVehiclesInZip(zipPath: string): Promise<Map<string, string>> {
    return new Promise((resolve) => {
      const out = new Map<string, string>()
      yauzlOpen(zipPath, { lazyEntries: true }, (err, zipFile) => {
        if (err || !zipFile) { resolve(new Map()); return }
        zipFile.readEntry()
        zipFile.on('entry', (entry: Entry) => {
          const fn = entry.fileName.replace(/\\/g, '/')
          const infoMatch = fn.match(/^vehicles\/([^/]+)\/info\.json$/i)
          const jbeamMatch = fn.match(/^vehicles\/([^/]+)\/[^/]+\.jbeam$/i)
          const match = infoMatch || jbeamMatch
          if (!match || !match[1]) {
            zipFile.readEntry()
            return
          }

          const vehicleId = match[1].toLowerCase()
          if (!out.has(vehicleId)) out.set(vehicleId, vehicleId)

          zipFile.openReadStream(entry, (streamErr, stream) => {
            if (streamErr || !stream) {
              zipFile.readEntry()
              return
            }

            let raw = ''
            stream.on('data', (chunk: Buffer) => {
              raw += chunk.toString('utf-8')
            })
            stream.on('error', () => {
              zipFile.readEntry()
            })
            stream.on('end', () => {
              try {
                let candidate: string | null = null

                if (infoMatch) {
                  const parsed = JSON.parse(raw) as Record<string, unknown>
                  candidate =
                    (typeof parsed.Name === 'string' && parsed.Name.trim()) ||
                    (typeof parsed.name === 'string' && parsed.name.trim()) ||
                    (typeof parsed.model === 'string' && parsed.model.trim()) ||
                    null
                } else {
                  // JBeam is JSON-like and may not be strict JSON, so use robust regex fallback.
                  const infoScoped = raw.match(/"information"\s*:\s*\{[\s\S]*?"Name"\s*:\s*"([^"]+)"/i)
                  const anyName = raw.match(/"Name"\s*:\s*"([^"]+)"/)
                  const lowerName = raw.match(/"name"\s*:\s*"([^"]+)"/)
                  candidate = (infoScoped?.[1] || anyName?.[1] || lowerName?.[1] || '').trim() || null
                }

                if (candidate && candidate.toLowerCase() !== vehicleId) {
                  out.set(vehicleId, candidate)
                }
              } catch {
                // Ignore malformed metadata; fallback stays vehicle id.
              }
              zipFile.readEntry()
            })
          })
        })
        zipFile.on('end', () => { zipFile.close(); resolve(out) })
        zipFile.on('error', () => resolve(out))
      })
    })
  }

  /** Vehicle ids and display names from server-provided client archives. */
  private async listServerVehicles(serverDir: string, resourceFolder: string): Promise<{ names: string[]; displayNames: Record<string, string> }> {
    const clientDir = join(serverDir, resourceFolder, 'Client')
    if (!existsSync(clientDir)) return { names: [], displayNames: {} }
    const files = await readdir(clientDir, { withFileTypes: true }).catch(() => [])
    const names = new Set<string>()
    const displayNames: Record<string, string> = {}
    for (const f of files) {
      if (!f.isFile() || !f.name.toLowerCase().endsWith('.zip')) continue
      const zipPath = join(clientDir, f.name)
      const discovered = await this.discoverVehiclesInZip(zipPath).catch(() => new Map<string, string>())
      for (const [id, display] of discovered.entries()) {
        names.add(id)
        if (display && display !== id) displayNames[id] = display
      }
    }
    return {
      names: Array.from(names).sort((a, b) => a.localeCompare(b)),
      displayNames,
    }
  }

  private normalizeNameList(input: unknown): string[] {
    if (!Array.isArray(input)) return []
    const out = new Set<string>()
    for (const v of input) {
      if (typeof v !== 'string') continue
      const n = v.trim().toLowerCase()
      if (!n) continue
      out.add(n)
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b))
  }

  private async readModGateConfigFile(cfgPath: string): Promise<Partial<ModGateConfigFile>> {
    if (!existsSync(cfgPath)) return {}
    try {
      const parsed = JSON.parse(await readFile(cfgPath, 'utf-8')) as Partial<ModGateConfigFile>
      return parsed
    } catch {
      return {}
    }
  }

  async getModGateConfig(id: string): Promise<{ exists: boolean; config: ModGateConfigFile | null }> {
    const config = await this.getServerConfig(id)
    if (!config) return { exists: false, config: null }
    await this.syncModGatePlugin(id, config)
    const cfgPath = join(this.serversDir, id, 'beamcm_mod_gate.json')
    if (!existsSync(cfgPath)) return { exists: false, config: null }
    try {
      const parsed = JSON.parse(await readFile(cfgPath, 'utf-8')) as ModGateConfigFile
      return { exists: true, config: parsed }
    } catch {
      return { exists: false, config: null }
    }
  }

  async saveModGateConfig(id: string, input: SaveModGateConfigInput): Promise<{ success: boolean; error?: string }> {
    try {
      const config = await this.getServerConfig(id)
      if (!config) return { success: false, error: 'Server not found' }
      const serverDir = join(this.serversDir, id)
      const cfgPath = join(serverDir, 'beamcm_mod_gate.json')

      // Refresh discovered baseline first.
      await this.syncModGatePlugin(id, config)

      const existing = await this.readModGateConfigFile(cfgPath)
      const stock = this.normalizeNameList(existing.stockVehicleNames)
      const server = this.normalizeNameList(existing.serverVehicleNames)
      const baseline = new Set<string>([...stock, ...server])
      const desired = new Set<string>(this.normalizeNameList(input.allowedVehicleNames))

      const denied: string[] = []
      const forced: string[] = []
      for (const v of baseline) {
        if (!desired.has(v)) denied.push(v)
      }
      for (const v of desired) {
        if (!baseline.has(v)) forced.push(v)
      }

      const next: Partial<ModGateConfigFile> = {
        ...existing,
        vehicleDeniedNames: denied.sort((a, b) => a.localeCompare(b)),
        vehicleForcedAllowedNames: forced.sort((a, b) => a.localeCompare(b)),
      }
      await writeFile(cfgPath, JSON.stringify(next, null, 2), 'utf-8')

      // Rebuild effective allowlist from updated overrides.
      await this.syncModGatePlugin(id, config)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  /** Stock vehicle ids from BeamNG installDir/content/vehicles/*.zip (if known). */
  private async listStockVehicleNames(): Promise<string[]> {
    const installDir = this.installDirResolver?.()
    if (!installDir) return []
    const vehiclesDir = join(installDir, 'content', 'vehicles')
    if (!existsSync(vehiclesDir)) return []
    const files = await readdir(vehiclesDir, { withFileTypes: true }).catch(() => [])
    return files
      .filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.zip'))
      .map((f) => f.name.replace(/\.zip$/i, '').toLowerCase())
      .sort((a, b) => a.localeCompare(b))
  }

  private async syncModGatePlugin(id: string, config: HostedServerConfig): Promise<void> {
    const serverDir = join(this.serversDir, id)
    const pluginDir = join(serverDir, config.resourceFolder, 'Server', 'BeamCMModGate')
    const pluginPath = join(pluginDir, 'main.lua')
    const cfgPath = join(serverDir, 'beamcm_mod_gate.json')

    const allowedArchives = await this.listClientArchives(serverDir, config.resourceFolder)
    const [serverVehicles, stockVehicleNames] = await Promise.all([
      this.listServerVehicles(serverDir, config.resourceFolder),
      this.listStockVehicleNames(),
    ])
    const serverVehicleNames = serverVehicles.names
    const existing = await this.readModGateConfigFile(cfgPath)
    const vehicleDeniedNames = this.normalizeNameList(existing.vehicleDeniedNames)
    const vehicleForcedAllowedNames = this.normalizeNameList(existing.vehicleForcedAllowedNames)

    const baseline = new Set<string>([...serverVehicleNames, ...stockVehicleNames])
    const allowedVehicleNames = new Set<string>(baseline)
    for (const denied of vehicleDeniedNames) allowedVehicleNames.delete(denied)
    for (const forced of vehicleForcedAllowedNames) allowedVehicleNames.add(forced)

    const cfg: ModGateConfigFile = {
      enabled: !!config.clientContentGate,
      allowedArchives,
      allowedVehicleNames: Array.from(allowedVehicleNames).sort((a, b) => a.localeCompare(b)),
      stockVehicleNames,
      serverVehicleNames,
      vehicleDisplayNames: serverVehicles.displayNames,
      vehicleDeniedNames,
      vehicleForcedAllowedNames,
      updatedAt: new Date().toISOString(),
    }
    await writeFile(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8')

    if (!config.clientContentGate) {
      if (existsSync(pluginDir)) await rm(pluginDir, { recursive: true, force: true })
      return
    }

    if (!existsSync(pluginDir)) await mkdir(pluginDir, { recursive: true })
    await writeFile(pluginPath, buildModGateLuaPlugin(serverDir), 'utf-8')
  }

  /* ── Ban Enforcer Plugin Deploy ── */

  async deployBanPlugin(id: string): Promise<void> {
    const config = await this.getServerConfig(id)
    if (!config) throw new Error('Server not found')
    const pluginDir = join(this.serversDir, id, config.resourceFolder, 'Server', 'BeamMPCMBans')
    if (!existsSync(pluginDir)) await mkdir(pluginDir, { recursive: true })
    const pluginPath = join(pluginDir, 'main.lua')
    const serverDir = join(this.serversDir, id)
    await writeFile(pluginPath, buildBanEnforcerPlugin(serverDir), 'utf-8')
  }

  async isBanPluginDeployed(id: string): Promise<boolean> {
    const config = await this.getServerConfig(id)
    if (!config) return false
    const pluginPath = join(this.serversDir, id, config.resourceFolder, 'Server', 'BeamMPCMBans', 'main.lua')
    return existsSync(pluginPath)
  }

  async undeployBanPlugin(id: string): Promise<void> {
    const config = await this.getServerConfig(id)
    if (!config) throw new Error('Server not found')
    const pluginDir = join(this.serversDir, id, config.resourceFolder, 'Server', 'BeamMPCMBans')
    if (existsSync(pluginDir)) {
      await rm(pluginDir, { recursive: true, force: true })
    }
  }

  async isAnyIpBanned(id: string): Promise<boolean> {
    try {
      const raw = await readFile(join(this.serversDir, id, 'ip_meta.json'), 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        for (const meta of Object.values(parsed)) {
          if (typeof meta === 'object' && meta !== null && (meta as Record<string, unknown>).banned === true) {
            return true
          }
        }
      }
    } catch {
      // File doesn't exist or is invalid
    }
    return false
  }

  /* ── Per-Server Support Tickets ── */

  private supportDir(id: string): string {
    return join(this.serversDir, id, 'support')
  }

  private supportTicketsPath(id: string): string {
    return join(this.supportDir(id), 'tickets.json')
  }

  private supportConfigPath(id: string): string {
    return join(this.supportDir(id), 'ingest.json')
  }

  private supportTicketUiConfigPath(id: string): string {
    return join(this.supportDir(id), 'ticket-ui.json')
  }

  private async ensureSupportDir(id: string): Promise<void> {
    const dir = this.supportDir(id)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  }

  private async getSupportConfig(id: string): Promise<HostedServerSupportIngestConfig> {
    await this.ensureSupportDir(id)
    const cfgPath = this.supportConfigPath(id)
    const serverCfg = await this.getServerConfig(id)
    const fallbackPort = (serverCfg?.port ?? 30814) + 1000
    const fallback: HostedServerSupportIngestConfig = {
      enabled: false,
      port: fallbackPort,
      token: randomUUID(),
      publicHost: '',
    }
    if (!existsSync(cfgPath)) {
      await writeFile(cfgPath, JSON.stringify(fallback, null, 2), 'utf-8')
      return fallback
    }
    try {
      const parsed = JSON.parse(await readFile(cfgPath, 'utf-8')) as Partial<HostedServerSupportIngestConfig>
      const merged: HostedServerSupportIngestConfig = {
        enabled: parsed.enabled === true,
        port: typeof parsed.port === 'number' && parsed.port > 0 ? parsed.port : fallback.port,
        token: typeof parsed.token === 'string' && parsed.token.trim().length > 0 ? parsed.token : fallback.token,
        publicHost: typeof parsed.publicHost === 'string' ? parsed.publicHost.trim() : fallback.publicHost,
      }
      if (
        merged.token !== parsed.token
        || merged.port !== parsed.port
        || merged.enabled !== parsed.enabled
        || merged.publicHost !== parsed.publicHost
      ) {
        await writeFile(cfgPath, JSON.stringify(merged, null, 2), 'utf-8')
      }
      return merged
    } catch {
      await writeFile(cfgPath, JSON.stringify(fallback, null, 2), 'utf-8')
      return fallback
    }
  }

  private async setSupportConfig(id: string, config: HostedServerSupportIngestConfig): Promise<void> {
    await this.ensureSupportDir(id)
    await writeFile(this.supportConfigPath(id), JSON.stringify(config, null, 2), 'utf-8')
  }

  async getSupportTicketUiConfig(id: string): Promise<HostedServerSupportTicketUiConfig> {
    await this.ensureSupportDir(id)
    const cfgPath = this.supportTicketUiConfigPath(id)
    const fallback: HostedServerSupportTicketUiConfig = {
      topics: ['Bug Report', 'Gameplay Issue', 'Player Report', 'Connection Problem', 'Other'],
      maxMessageLength: 1500,
      enablePriorityDropdown: false,
      reporterIdentityMode: 'auto',
      includeLogsSnapshot: true,
      includeSessionMetadata: true,
      includeLocation: true,
      includeLoadedMods: true,
      includeVersions: true,
      includePcSpecs: true,
    }

    const normalize = (raw: Partial<HostedServerSupportTicketUiConfig>): HostedServerSupportTicketUiConfig => {
      const topics = Array.isArray(raw.topics)
        ? raw.topics
          .map((v) => (typeof v === 'string' ? v.trim() : ''))
          .filter((v) => v.length > 0)
          .slice(0, 20)
          .map((v) => v.slice(0, 64))
        : fallback.topics
      return {
        topics: topics.length > 0 ? topics : fallback.topics,
        maxMessageLength: typeof raw.maxMessageLength === 'number'
          ? Math.min(5000, Math.max(120, Math.floor(raw.maxMessageLength)))
          : fallback.maxMessageLength,
        enablePriorityDropdown: raw.enablePriorityDropdown ?? fallback.enablePriorityDropdown,
        reporterIdentityMode: raw.reporterIdentityMode === 'manual' ? 'manual' : 'auto',
        includeLogsSnapshot: raw.includeLogsSnapshot ?? fallback.includeLogsSnapshot,
        includeSessionMetadata: raw.includeSessionMetadata ?? fallback.includeSessionMetadata,
        includeLocation: raw.includeLocation ?? fallback.includeLocation,
        includeLoadedMods: raw.includeLoadedMods ?? fallback.includeLoadedMods,
        includeVersions: raw.includeVersions ?? fallback.includeVersions,
        includePcSpecs: raw.includePcSpecs ?? fallback.includePcSpecs,
      }
    }

    if (!existsSync(cfgPath)) {
      await writeFile(cfgPath, JSON.stringify(fallback, null, 2), 'utf-8')
      return fallback
    }

    try {
      const parsed = JSON.parse(await readFile(cfgPath, 'utf-8')) as Partial<HostedServerSupportTicketUiConfig>
      const merged = normalize(parsed)
      if (JSON.stringify(parsed) !== JSON.stringify(merged)) {
        await writeFile(cfgPath, JSON.stringify(merged, null, 2), 'utf-8')
      }
      return merged
    } catch {
      await writeFile(cfgPath, JSON.stringify(fallback, null, 2), 'utf-8')
      return fallback
    }
  }

  async updateSupportTicketUiConfig(id: string, patch: Partial<HostedServerSupportTicketUiConfig>): Promise<HostedServerSupportTicketUiConfig> {
    const current = await this.getSupportTicketUiConfig(id)
    const nextTopics = Array.isArray(patch.topics)
      ? patch.topics
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v) => v.length > 0)
        .slice(0, 20)
        .map((v) => v.slice(0, 64))
      : current.topics

    const next: HostedServerSupportTicketUiConfig = {
      topics: nextTopics.length > 0 ? nextTopics : current.topics,
      maxMessageLength: typeof patch.maxMessageLength === 'number'
        ? Math.min(5000, Math.max(120, Math.floor(patch.maxMessageLength)))
        : current.maxMessageLength,
      enablePriorityDropdown: patch.enablePriorityDropdown ?? current.enablePriorityDropdown,
      reporterIdentityMode: patch.reporterIdentityMode === 'manual'
        ? 'manual'
        : (patch.reporterIdentityMode === 'auto' ? 'auto' : current.reporterIdentityMode),
      includeLogsSnapshot: patch.includeLogsSnapshot ?? current.includeLogsSnapshot,
      includeSessionMetadata: patch.includeSessionMetadata ?? current.includeSessionMetadata,
      includeLocation: patch.includeLocation ?? current.includeLocation,
      includeLoadedMods: patch.includeLoadedMods ?? current.includeLoadedMods,
      includeVersions: patch.includeVersions ?? current.includeVersions,
      includePcSpecs: patch.includePcSpecs ?? current.includePcSpecs,
    }

    await this.ensureSupportDir(id)
    await writeFile(this.supportTicketUiConfigPath(id), JSON.stringify(next, null, 2), 'utf-8')
    return next
  }

  async getSupportIngestStatus(id: string): Promise<HostedServerSupportIngestStatus> {
    const config = await this.getSupportConfig(id)
    const serverConfig = await this.getServerConfig(id)
    const senderDeployed = serverConfig
      ? existsSync(join(this.getServerDir(id), serverConfig.resourceFolder, 'Client', 'beamcm-support-sender.zip'))
      : false
    const endpointHost = config.publicHost || '<server-ip>'
    return {
      running: this.supportIngest.has(id),
      senderDeployed,
      config,
      endpointPath: '/ticket',
      endpointExample: `http://${endpointHost}:${config.port}/ticket`,
    }
  }

  async updateSupportIngestConfig(id: string, patch: Partial<HostedServerSupportIngestConfig>): Promise<HostedServerSupportIngestStatus> {
    const current = await this.getSupportConfig(id)
    const next: HostedServerSupportIngestConfig = {
      enabled: patch.enabled ?? current.enabled,
      port: patch.port ?? current.port,
      token: patch.token ?? current.token,
      publicHost: typeof patch.publicHost === 'string' ? patch.publicHost.trim() : current.publicHost,
    }
    await this.setSupportConfig(id, next)

    const running = this.supportIngest.get(id)
    if (running && (running.port !== next.port || running.token !== next.token || !next.enabled)) {
      await this.stopSupportIngest(id)
    }
    if (next.enabled && !this.supportIngest.has(id)) {
      await this.startSupportIngest(id)
    }
    return this.getSupportIngestStatus(id)
  }

  async listSupportTickets(id: string): Promise<SupportTicket[]> {
    await this.ensureSupportDir(id)
    const p = this.supportTicketsPath(id)
    if (!existsSync(p)) return []
    try {
      const parsed = JSON.parse(await readFile(p, 'utf-8')) as SupportTicket[]
      if (!Array.isArray(parsed)) return []
      let changed = false
      const normalized = parsed.map((ticket) => {
        if ((ticket.status as string) === 'waiting-on-user') {
          changed = true
          return { ...ticket, status: 'in-progress' as SupportTicketStatus }
        }
        return ticket
      })
      if (changed) {
        await this.saveSupportTickets(id, normalized)
      }
      return [...normalized].sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  }

  private async saveSupportTickets(id: string, tickets: SupportTicket[]): Promise<void> {
    await this.ensureSupportDir(id)
    await writeFile(this.supportTicketsPath(id), JSON.stringify(tickets, null, 2), 'utf-8')
  }

  async createSupportTicket(id: string, input: SupportTicketCreateInput): Promise<SupportTicket> {
    const now = Date.now()
    const created: SupportTicket = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      source: input.source ?? 'desktop',
      status: 'new',
      priority: input.priority ?? 'normal',
      subject: input.subject,
      message: input.message,
      reporterName: input.reporterName,
      reporterBeammpId: input.reporterBeammpId,
      tags: input.tags ?? [],
      payload: input.payload ?? {},
    }
    const tickets = await this.listSupportTickets(id)
    tickets.unshift(created)
    await this.saveSupportTickets(id, tickets)
    return created
  }

  async updateSupportTicket(id: string, ticketId: string, patch: SupportTicketUpdateInput): Promise<SupportTicket | null> {
    const tickets = await this.listSupportTickets(id)
    const ticket = tickets.find((t) => t.id === ticketId)
    if (!ticket) return null
    if (patch.status !== undefined) ticket.status = patch.status
    if (patch.priority !== undefined) ticket.priority = patch.priority
    if (patch.subject !== undefined) ticket.subject = patch.subject
    if (patch.message !== undefined) ticket.message = patch.message
    if (patch.assignedTo !== undefined) ticket.assignedTo = patch.assignedTo
    if (patch.tags !== undefined) ticket.tags = patch.tags
    if (patch.internalNotes !== undefined) ticket.internalNotes = patch.internalNotes
    if (patch.payload !== undefined) ticket.payload = patch.payload
    ticket.updatedAt = Date.now()
    await this.saveSupportTickets(id, tickets)
    return ticket
  }

  async deleteSupportTicket(id: string, ticketId: string): Promise<boolean> {
    const tickets = await this.listSupportTickets(id)
    const next = tickets.filter((t) => t.id !== ticketId)
    if (next.length === tickets.length) return false
    await this.saveSupportTickets(id, next)
    return true
  }

  private async readSupportRequestBody(req: IncomingMessage): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      let total = 0
      req.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > 2 * 1024 * 1024) {
          reject(new Error('Request body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }

  private writeJson(res: ServerResponse, code: number, payload: unknown): void {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(JSON.stringify(payload))
  }

  async startSupportIngest(id: string): Promise<HostedServerSupportIngestStatus> {
    if (this.supportIngest.has(id)) return this.getSupportIngestStatus(id)
    const config = await this.getSupportConfig(id)
    const server = createHttpServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Support-Token')
        res.end()
        return
      }

      if (req.method === 'GET' && req.url === '/health') {
        this.writeJson(res, 200, { ok: true, serverId: id })
        return
      }

      if (req.method !== 'POST' || req.url !== '/ticket') {
        this.writeJson(res, 404, { success: false, error: 'Not found' })
        return
      }

      const authHeader = req.headers.authorization
      const bearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : ''
      const tokenHeader = typeof req.headers['x-support-token'] === 'string' ? req.headers['x-support-token'] : ''
      const providedToken = bearer || tokenHeader
      if (providedToken !== config.token) {
        this.writeJson(res, 401, { success: false, error: 'Unauthorized' })
        return
      }

      try {
        const raw = await this.readSupportRequestBody(req)
        const parsed = JSON.parse(raw) as SupportTicketCreateInput
        if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.message !== 'string') {
          this.writeJson(res, 400, { success: false, error: 'Invalid payload' })
          return
        }
        const created = await this.createSupportTicket(id, { ...parsed, source: 'in-game' })
        this.writeJson(res, 200, { success: true, id: created.id })
      } catch (err) {
        this.writeJson(res, 500, { success: false, error: String(err) })
      }
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port, '0.0.0.0', () => {
        server.off('error', reject)
        resolve()
      })
    })

    this.supportIngest.set(id, { server, port: config.port, token: config.token })
    return this.getSupportIngestStatus(id)
  }

  async stopSupportIngest(id: string): Promise<HostedServerSupportIngestStatus> {
    const running = this.supportIngest.get(id)
    if (!running) return this.getSupportIngestStatus(id)
    await new Promise<void>((resolve) => running.server.close(() => resolve()))
    this.supportIngest.delete(id)
    return this.getSupportIngestStatus(id)
  }

  async isVoicePluginDeployed(id: string): Promise<boolean> {
    const config = await this.getServerConfig(id)
    if (!config) return false
    const pluginPath = join(this.serversDir, id, config.resourceFolder, 'Server', 'BeamMPCMVoice', 'main.lua')
    return existsSync(pluginPath)
  }

  async undeployVoicePlugin(id: string): Promise<void> {
    const config = await this.getServerConfig(id)
    if (!config) throw new Error('Server not found')
    const pluginDir = join(this.serversDir, id, config.resourceFolder, 'Server', 'BeamMPCMVoice')
    if (existsSync(pluginDir)) {
      await rm(pluginDir, { recursive: true, force: true })
    }
    // Also remove the client-side overlay zip distributed via Resources/Client
    // so joining players stop receiving the in-game voice overlay.
    const overlayZipPath = join(this.serversDir, id, config.resourceFolder, 'Client', 'beamcm-voice-overlay.zip')
    if (existsSync(overlayZipPath)) {
      await rm(overlayZipPath, { force: true })
    }
  }

  /* ── CRUD ── */

  async listServers(): Promise<HostedServerEntry[]> {
    await this.ensureDir()
    const entries: HostedServerEntry[] = []
    const dirs = await readdir(this.serversDir, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      const cfgPath = join(this.serversDir, d.name, 'server.json')
      if (!existsSync(cfgPath)) continue
      try {
        const raw = await readFile(cfgPath, 'utf-8')
        const config = this.deserializeConfig(raw)
        entries.push({ config, status: this.getStatus(config.id) })
      } catch { /* skip corrupt entries */ }
    }
    return entries
  }

  async createServer(partial?: Partial<HostedServerConfig>, defaultPortSpec?: string): Promise<HostedServerConfig> {
    const id = randomUUID()
    const base: HostedServerConfig = { ...DEFAULT_CONFIG, id, ...partial }

    // If no explicit port was provided, pick the next available from the configured port list
    if (!partial?.port && defaultPortSpec) {
      const allowedPorts = parsePortSpec(defaultPortSpec)
      if (allowedPorts.length > 0) {
        const usedPorts = new Set(
          (await this.listServers()).map((s) => s.config.port)
        )
        const nextPort = allowedPorts.find((p) => !usedPorts.has(p))
        if (nextPort !== undefined) {
          base.port = nextPort
        }
      }
    }

    const config = base
    const dir = join(this.serversDir, id)
    await mkdir(dir, { recursive: true })
    await mkdir(join(dir, config.resourceFolder), { recursive: true })

    // Copy exe into the new server directory first
    if (this.exePath && existsSync(this.exePath)) {
      await copyFile(this.exePath, this.serverExePath(id))
    }

    // Run the exe briefly so it generates a real ServerConfig.toml + directory structure
    await this.seedServerConfig(id)

    await writeFile(join(dir, 'server.json'), this.serializeConfig(config), 'utf-8')
    // Merge user values on top of the real generated config
    await this.writeToml(config)
    await this.syncModGatePlugin(id, config)
    return config
  }

  async updateServer(id: string, partial: Partial<HostedServerConfig>): Promise<HostedServerConfig> {
    const dir = join(this.serversDir, id)
    const raw = await readFile(join(dir, 'server.json'), 'utf-8')
    const config: HostedServerConfig = { ...this.deserializeConfig(raw), ...partial, id }
    await writeFile(join(dir, 'server.json'), this.serializeConfig(config), 'utf-8')
    await this.writeToml(config)
    await this.syncModGatePlugin(id, config)
    return config
  }

  async deleteServer(id: string): Promise<void> {
    if (this.running.has(id)) {
      this.stopServer(id)
    }
    if (this.supportIngest.has(id)) {
      await this.stopSupportIngest(id)
    }
    const dir = join(this.serversDir, id)
    await rm(dir, { recursive: true, force: true })
  }

  async getServerConfig(id: string): Promise<HostedServerConfig | null> {
    const cfgPath = join(this.serversDir, id, 'server.json')
    if (!existsSync(cfgPath)) return null
    const raw = await readFile(cfgPath, 'utf-8')
    return this.deserializeConfig(raw)
  }

  /* ── Process lifecycle ── */

  async startServer(id: string): Promise<{ success: boolean; error?: string }> {
    if (this.running.has(id)) {
      return { success: false, error: 'Server is already running' }
    }
    const effectiveExe = this.resolveExePath()
    if (!effectiveExe || !existsSync(effectiveExe)) {
      return { success: false, error: 'BeamMP-Server executable not found. Download or drag-and-drop the exe.' }
    }
    const config = await this.getServerConfig(id)
    if (!config) return { success: false, error: 'Server config not found' }

    // Refresh TOML before launch
    await this.writeToml(config)
    await this.syncModGatePlugin(id, config)

    // Ensure this server has its own exe copy
    const localExe = this.serverExePath(id)
    if (!existsSync(localExe)) {
      await copyFile(effectiveExe, localExe)
      await this.makeExecutable(localExe)
    }

    const serverDir = join(this.serversDir, id)
    // Keep deployed tracker plugin in sync with the embedded template so fixes
    // apply on restart without requiring manual undeploy/redeploy.
    try {
      const trackerMain = join(serverDir, config.resourceFolder, 'Server', 'BeamMPCM', 'main.lua')
      if (existsSync(trackerMain)) {
        await writeFile(trackerMain, buildTrackerLuaPlugin(serverDir), 'utf-8')
      }
    } catch {
      // Non-fatal: server can still start even if plugin refresh fails.
    }
    const child = spawn(localExe, [], {
      cwd: serverDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    const entry: RunningServer = {
      process: child,
      state: 'starting',
      startedAt: Date.now(),
      players: 0,
      error: null,
      consoleBuffer: [],
      memoryBytes: 0,
      cpuPercent: 0,
      resourceTimer: null,
      connectionPollTimer: null,
      analyticsPollerTimer: null
    }
    this.running.set(id, entry)

    // Start periodic resource monitoring
    entry.resourceTimer = setInterval(() => {
      const pid = child.pid
      if (!pid) return
      pidusage(pid).then((stats) => {
        const newMem = stats.memory
        const newCpu = Math.round(stats.cpu * 10) / 10
        // Only emit when the values actually shift meaningfully — otherwise a
        // multi-instance setup re-renders the entire ServerManager tree every
        // 2 s for nothing. ~2 MiB or ~1 % cpu delta = perceivable change.
        const memDelta = Math.abs(newMem - entry.memoryBytes)
        const cpuDelta = Math.abs(newCpu - entry.cpuPercent)
        if (memDelta < 2 * 1024 * 1024 && cpuDelta < 1.0) return
        entry.memoryBytes = newMem
        entry.cpuPercent = newCpu
        this.emitStatusChange(id)
      }).catch(() => {})
    }, 2000)

    // Poll connection count on server port every 3 seconds for accurate player count
    entry.connectionPollTimer = setInterval(() => {
      this.pollConnectionCount(config.port).then((count) => {
        if (count !== entry.players) {
          entry.players = count
          this.emitStatusChange(id)
        }
      }).catch(() => {})
    }, 3000)

    // Background analytics poller — reads active player names from the tracker
    // plugin's analytics file every 10 s. We deliberately avoid raw TCP connections
    // to the BeamMP server here because the server counts every TCP connect attempt
    // (including info queries) against its per-IP concurrent-connection limit (10),
    // which causes ECONNABORTED on reconnect after repeated sessions.
    if (this.analyticsService) {
      const svc = this.analyticsService
      const trackerFile = join(this.serversDir, id, 'player_analytics.json')
      entry.analyticsPollerTimer = setInterval(() => {
        readFile(trackerFile, 'utf-8')
          .then((raw) => {
            const data = JSON.parse(raw)
            const activeSessions: Array<{ playerName?: string }> = Array.isArray(data.activeSessions) ? data.activeSessions : []
            const names = activeSessions
              .map((s) => (typeof s.playerName === 'string' ? s.playerName : ''))
              .filter((n) => n.length > 0)
            return svc.updatePlayers(id, names)
          })
          .catch(() => {})
      }, 10000)
    }

    const pushLine = (line: string): void => {
      entry.consoleBuffer.push(line)
      if (entry.consoleBuffer.length > MAX_CONSOLE_LINES) {
        entry.consoleBuffer.splice(0, entry.consoleBuffer.length - MAX_CONSOLE_LINES)
      }
      this.emitConsole(id, line)
    }

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        pushLine(line.trimEnd())
        // Detect when server is ready
        if (line.includes('Server ready') || line.includes('Listening on port')) {
          entry.state = 'running'
          this.emitStatusChange(id)
        }
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        pushLine(`[ERR] ${line.trimEnd()}`)
      }
    })

    child.on('error', (err) => {
      entry.state = 'error'
      entry.error = err.message
      this.emitStatusChange(id)
    })

    child.on('exit', (code) => {
      if (entry.resourceTimer) clearInterval(entry.resourceTimer)
      if (entry.connectionPollTimer) clearInterval(entry.connectionPollTimer)
      if (entry.analyticsPollerTimer) clearInterval(entry.analyticsPollerTimer)
      this.analyticsService?.endAllSessions(id).catch(() => {})
      if (entry.state !== 'error') {
        entry.state = 'stopped'
        if (code !== 0 && code !== null) {
          entry.state = 'error'
          entry.error = `Process exited with code ${code}`
        }
      }
      this.running.delete(id)
      this.emitStatusChange(id)
    })

    // After a short time, mark as running even if we didn't detect the ready message
    setTimeout(() => {
      const e = this.running.get(id)
      if (e && e.state === 'starting') {
        e.state = 'running'
        this.emitStatusChange(id)
      }
    }, 5000)

    // Notify subscribers (e.g. voice chat) so they can deploy any per-server
    // payloads on demand instead of bloating every managed server folder at
    // CM startup.
    try {
      this.onServerStartCallback?.(id, serverDir, config.resourceFolder)
    } catch (err) {
      console.warn('[ServerManager] onServerStart callback failed:', err)
    }

    // Auto-start ingest if enabled in config OR if the sender mod is deployed
    // (handles the case where ingest.json got out of sync with what's actually deployed).
    try {
      const supportCfg = await this.getSupportConfig(id)
      const ingestStatus = await this.getSupportIngestStatus(id)
      if ((supportCfg.enabled || ingestStatus.senderDeployed) && !this.supportIngest.has(id)) {
        await this.startSupportIngest(id)
        if (ingestStatus.senderDeployed && !supportCfg.enabled) {
          // Keep config in sync so subsequent starts work without this fallback.
          await this.setSupportConfig(id, { ...supportCfg, enabled: true })
        }
      }
    } catch {
      // Non-fatal: server still starts even if ingest fails to bind.
    }

    this.emitStatusChange(id)
    return { success: true }
  }

  stopServer(id: string): void {
    const entry = this.running.get(id)
    if (!entry) return
    if (entry.resourceTimer) clearInterval(entry.resourceTimer)
    if (entry.connectionPollTimer) clearInterval(entry.connectionPollTimer)
    if (entry.analyticsPollerTimer) clearInterval(entry.analyticsPollerTimer)
    this.analyticsService?.endAllSessions(id).catch(() => {})
    entry.state = 'stopped'
    entry.process.kill()
    this.running.delete(id)
    // Auto-stop ingest when server stops
    this.stopSupportIngest(id).catch(() => {})
    this.emitStatusChange(id)
  }

  async restartServer(id: string): Promise<{ success: boolean; error?: string }> {
    this.stopServer(id)
    // Small delay for port release
    await new Promise((r) => setTimeout(r, 1000))
    return this.startServer(id)
  }

  getStatus(id: string): HostedServerStatus {
    const totalMem = totalmem()
    const entry = this.running.get(id)
    if (!entry) {
      return { id, state: 'stopped', pid: null, uptimeMs: 0, startedAt: null, players: 0, error: null, memoryBytes: 0, cpuPercent: 0, totalMemoryBytes: totalMem }
    }
    return {
      id,
      state: entry.state,
      pid: entry.process.pid ?? null,
      uptimeMs: Date.now() - entry.startedAt,
      startedAt: entry.startedAt,
      players: entry.players,
      error: entry.error,
      memoryBytes: entry.memoryBytes,
      cpuPercent: entry.cpuPercent,
      totalMemoryBytes: totalMem
    }
  }

  getConsole(id: string): string[] {
    return this.running.get(id)?.consoleBuffer ?? []
  }

  sendCommand(id: string, command: string): void {
    const entry = this.running.get(id)
    if (!entry || !entry.process.stdin?.writable) return
    entry.process.stdin.write(command + '\n')
  }

  /* ── Cleanup on app quit ── */

  shutdownAll(): void {
    for (const [id] of this.running) {
      this.stopServer(id)
    }
  }

  /* ── Internals ── */

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.serversDir)) {
      await mkdir(this.serversDir, { recursive: true })
    }
  }

  /**
   * Run the server exe briefly so it generates a real ServerConfig.toml
   * with all default sections and fields the current version supports.
   */
  private async seedServerConfig(id: string): Promise<void> {
    const exe = this.serverExePath(id)
    if (!existsSync(exe)) return
    const dir = join(this.serversDir, id)
    const tomlPath = join(dir, 'ServerConfig.toml')
    if (existsSync(tomlPath)) return // already present

    return new Promise<void>((resolve) => {
      const child = spawn(exe, [], {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })

      // Give the process up to 6 seconds to generate config then kill it
      const timeout = setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
      }, 6000)

      // Watch for the config file to appear, then kill immediately
      const poll = setInterval(() => {
        if (existsSync(tomlPath)) {
          clearInterval(poll)
          clearTimeout(timeout)
          try { child.kill() } catch { /* ignore */ }
        }
      }, 200)

      child.on('exit', () => {
        clearInterval(poll)
        clearTimeout(timeout)
        resolve()
      })

      child.on('error', () => {
        clearInterval(poll)
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  /**
   * Simple TOML parser — returns a map of "Section.Key" → value string,
   * plus the raw lines for reconstruction.
   */
  private parseToml(content: string): { sections: Map<string, Map<string, string>>; rawLines: string[] } {
    const sections = new Map<string, Map<string, string>>()
    let currentSection = ''
    const rawLines = content.split(/\r?\n/)
    for (const line of rawLines) {
      const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/)
      if (sectionMatch) {
        currentSection = sectionMatch[1]
        if (!sections.has(currentSection)) sections.set(currentSection, new Map())
        continue
      }
      const kvMatch = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.+)$/)
      if (kvMatch && currentSection) {
        const sec = sections.get(currentSection) ?? new Map()
        sec.set(kvMatch[1], kvMatch[2].trim())
        sections.set(currentSection, sec)
      }
    }
    return { sections, rawLines }
  }

  private async writeToml(config: HostedServerConfig): Promise<void> {
    const dir = join(this.serversDir, config.id)
    const tomlPath = join(dir, 'ServerConfig.toml')
    const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

    // Our managed fields — these are the values we control
    const managed: Record<string, Record<string, string>> = {
      General: {
        Name: `"${esc(config.name)}"`,
        Port: String(config.port),
        AuthKey: `"${esc(config.authKey)}"`,
        MaxPlayers: String(config.maxPlayers),
        MaxCars: String(config.maxCars),
        Map: `"${esc(config.map)}"`,
        Description: `"${esc(config.description)}"`,
        Tags: `"${esc(config.tags)}"`,
        ResourceFolder: `"${esc(config.resourceFolder)}"`,
        LogChat: String(config.logChat),
        Private: String(config.private),
        Debug: String(config.debug),
        AllowGuests: String(config.allowGuests)
      }
    }

    // If a real config exists, read it and merge our values on top
    if (existsSync(tomlPath)) {
      const existing = await readFile(tomlPath, 'utf-8')
      const { sections, rawLines } = this.parseToml(existing)

      // Update existing keys with our managed values
      for (const [section, fields] of Object.entries(managed)) {
        const sec = sections.get(section) ?? new Map()
        for (const [key, val] of Object.entries(fields)) {
          sec.set(key, val)
        }
        sections.set(section, sec)
      }

      // Rebuild the file: walk the raw lines and replace values in-place,
      // preserving comments, ordering, and unknown sections/keys
      const output: string[] = []
      let curSec = ''
      const writtenKeys = new Map<string, Set<string>>()

      for (const line of rawLines) {
        const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/)
        if (sectionMatch) {
          // Before leaving the current section, append any managed keys not yet written
          if (curSec && managed[curSec]) {
            const written = writtenKeys.get(curSec) ?? new Set()
            for (const [key, val] of Object.entries(managed[curSec])) {
              if (!written.has(key)) {
                output.push(`${key} = ${val}`)
              }
            }
          }
          curSec = sectionMatch[1]
          output.push(line)
          continue
        }

        const kvMatch = line.match(/^(\s*)([A-Za-z_]\w*)\s*=\s*(.+)$/)
        if (kvMatch && curSec) {
          const [, indent, key] = kvMatch
          const sec = sections.get(curSec)
          if (sec?.has(key)) {
            output.push(`${indent}${key} = ${sec.get(key)}`)
            const written = writtenKeys.get(curSec) ?? new Set()
            written.add(key)
            writtenKeys.set(curSec, written)
          } else {
            output.push(line)
          }
        } else {
          output.push(line)
        }
      }

      // Append any managed keys from sections that didn't exist in the file
      for (const [section, fields] of Object.entries(managed)) {
        if (!sections.has(section) || !rawLines.some((l) => l.trim() === `[${section}]`)) {
          output.push('')
          output.push(`[${section}]`)
          for (const [key, val] of Object.entries(fields)) {
            output.push(`${key} = ${val}`)
          }
        } else {
          // Append remaining unwritten keys at end of file for this section
          const written = writtenKeys.get(section) ?? new Set()
          const remaining = Object.entries(fields).filter(([k]) => !written.has(k))
          if (remaining.length > 0) {
            for (const [key, val] of remaining) {
              output.push(`${key} = ${val}`)
            }
          }
        }
      }

      await writeFile(tomlPath, output.join('\n') + '\n', 'utf-8')
    } else {
      // No existing file — write a minimal config (fallback)
      const lines = [
        '[General]',
        `Name = "${esc(config.name)}"`,
        `Port = ${config.port}`,
        `AuthKey = "${esc(config.authKey)}"`,
        `MaxPlayers = ${config.maxPlayers}`,
        `MaxCars = ${config.maxCars}`,
        `Map = "${esc(config.map)}"`,
        `Description = "${esc(config.description)}"`,
        `Tags = "${esc(config.tags)}"`,
        `ResourceFolder = "${esc(config.resourceFolder)}"`,
        `LogChat = ${config.logChat}`,
        `Private = ${config.private}`,
        `Debug = ${config.debug}`,
        `AllowGuests = ${config.allowGuests}`,
        '',
        '[Misc]',
        `ImScaredOfUpdates = false`,
        `SendErrorsShowMessage = true`,
        `SendErrors = true`
      ]
      await writeFile(tomlPath, lines.join('\n') + '\n', 'utf-8')
    }
  }

  private consoleBatch = new Map<string, string[]>()
  private consoleFlushTimer: ReturnType<typeof setTimeout> | null = null

  private emitConsole(serverId: string, line: string): void {
    let batch = this.consoleBatch.get(serverId)
    if (!batch) {
      batch = []
      this.consoleBatch.set(serverId, batch)
    }
    batch.push(line)
    if (!this.consoleFlushTimer) {
      this.consoleFlushTimer = setTimeout(() => this.flushConsoleBatch(), 150)
    }
  }

  private flushConsoleBatch(): void {
    this.consoleFlushTimer = null
    const windows = BrowserWindow.getAllWindows()
    for (const [serverId, lines] of this.consoleBatch) {
      for (const win of windows) {
        if (!win.isDestroyed()) win.webContents.send('hostedServer:console', { serverId, lines })
      }
    }
    this.consoleBatch.clear()
  }

  private emitStatusChange(serverId: string): void {
    const status = this.getStatus(serverId)
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('hostedServer:statusChange', status)
    }
  }

  private emitExeStatus(): void {
    const s = this.getExeStatus()
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('hostedServer:exeStatus', s)
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

/* ── BeamCM Mod Gate Lua Plugin ── */
function buildModGateLuaPlugin(serverDir: string): string {
  const cfgPath = serverDir.replace(/\\/g, '/') + '/beamcm_mod_gate.json'
  return `-- BeamCM Mod Gate
-- Blocks vehicle spawns tied to client archives not provided by this server.

local TAG = "[BeamCM-ModGate] "
local cfgPath = "${cfgPath}"

local gateEnabled = false
local allowedArchives = {}
local allowedVehicleNames = {}

local function readConfig()
  local f = io.open(cfgPath, "r")
  if not f then
    print(TAG .. "Config not found: " .. cfgPath)
    return
  end
  local raw = f:read("*a")
  f:close()
  if not raw or raw == "" then return end
  local ok, cfg = pcall(Util.JsonDecode, raw)
  if not ok or type(cfg) ~= "table" then
    print(TAG .. "Invalid JSON config")
    return
  end
  gateEnabled = cfg.enabled == true
  allowedArchives = {}
  allowedVehicleNames = {}
  if type(cfg.allowedArchives) == "table" then
    for _, name in ipairs(cfg.allowedArchives) do
      if type(name) == "string" and name ~= "" then
        allowedArchives[string.lower(name)] = true
      end
    end
  end
  if type(cfg.allowedVehicleNames) == "table" then
    for _, name in ipairs(cfg.allowedVehicleNames) do
      if type(name) == "string" and name ~= "" then
        allowedVehicleNames[string.lower(name)] = true
      end
    end
  end
end

local function findZipHint(value)
  if type(value) == "string" then
    local lower = string.lower(value)
    local zip = string.match(lower, "([^/\\\\]+%.zip)")
    if zip then return zip end
    return nil
  end
  if type(value) ~= "table" then return nil end
  for _, v in pairs(value) do
    local hit = findZipHint(v)
    if hit then return hit end
  end
  return nil
end

local function decodeSpawnData(raw)
  if type(raw) == "table" then return raw end
  if type(raw) ~= "string" or raw == "" then return nil end
  local ok, decoded = pcall(Util.JsonDecode, raw)
  if ok and type(decoded) == "table" then return decoded end
  local start = string.find(raw, "{")
  if start then
    local ok2, decoded2 = pcall(Util.JsonDecode, string.sub(raw, start))
    if ok2 and type(decoded2) == "table" then return decoded2 end
  end
  return nil
end

function onInit()
  readConfig()
  MP.RegisterEvent("onVehicleSpawn", "onVehicleSpawn")
  print(TAG .. "Loaded. enabled=" .. tostring(gateEnabled) .. ", allowedArchives=" .. tostring((function()
    local c = 0
    for _ in pairs(allowedArchives) do c = c + 1 end
    return c
  end)()) .. ", allowedVehicleNames=" .. tostring((function()
    local c = 0
    for _ in pairs(allowedVehicleNames) do c = c + 1 end
    return c
  end)()))
end

function onVehicleSpawn(playerID, vehicleID, data)
  if not gateEnabled then return end
  local decoded = decodeSpawnData(data)
  local name = MP.GetPlayerName(playerID) or ("player:" .. tostring(playerID))

  local function blockSpawn(reason, archive, veh)
    local archiveOut = archive or "<none>"
    local vehOut = veh or "unknown"
    print(TAG .. "BLOCK sideloaded vehicle spawn player=" .. tostring(name) .. " vehicle=" .. tostring(vehOut) .. " archive=" .. tostring(archiveOut) .. " reason=" .. tostring(reason))

    local removed = false
    if MP.RemoveVehicle then
      local ok = pcall(MP.RemoveVehicle, playerID, vehicleID)
      removed = ok
    end
    if MP.SendChatMessage then
      MP.SendChatMessage(playerID, "Vehicle blocked: only server-provided mod packs are allowed on this server.")
    end
    if not removed then
      print(TAG .. "WARNING: RemoveVehicle failed for pid=" .. tostring(playerID) .. " vid=" .. tostring(vehicleID))
    end
    return 1
  end

  -- Strict mode: if payload cannot be decoded, block.
  if not decoded then
    return blockSpawn("undecodable-payload", nil, nil)
  end

  local archive = findZipHint(decoded)
  local veh = tostring(decoded.name or decoded.jbm or decoded.model or "unknown")
  local vehKey = string.lower(tostring(decoded.jbm or decoded.model or decoded.name or ""))

  -- No archive hint: allow only when the vehicle id/name is known to come from
  -- stock content or server-provided client archives.
  if not archive then
    if vehKey ~= "" and allowedVehicleNames[vehKey] then return end
    return blockSpawn("no-archive-hint", nil, veh)
  end
  if allowedArchives[archive] then return end

  return blockSpawn("archive-not-allowlisted", archive, veh)
end
`
}

/* ── BeamMPCM Tracker Lua Plugin ── */
function buildTrackerLuaPlugin(serverDir: string): string {
  // Use forward slashes — Lua io.open accepts them on Windows and they
  // don't need escaping inside the template literal.
  const posPath = serverDir.replace(/\\/g, '/') + '/player_positions.json'
  const analyticsPath = serverDir.replace(/\\/g, '/') + '/player_analytics.json'
  return `-- BeamMPCM Position Tracker Plugin
-- Auto-deployed by BeamMP Content Manager
-- Polls MP.GetPositionRaw every 500ms and writes player_positions.json
-- Also records durable player session analytics.

local TAG = "[BeamCM-Tracker] "
local posFile = "${posPath}"
local analyticsFile = "${analyticsPath}"
local posFileFallback = "player_positions.json"
local writeCount = 0
local lastPlayerCount = 0
local ANALYTICS_VERSION = 2
local MAX_COMPLETED_SESSIONS = 5000

local pendingAuth = {}
local activeSessions = {}
local completedSessions = {}

local function nowMs()
  -- Use epoch seconds to avoid 32-bit overflow in BeamMP's Lua runtime.
  -- The app normalizes second-based timestamps to ms on ingest.
  return os.time()
end

local function safeStr(value)
  if value == nil then return nil end
  local s = tostring(value)
  if s == "" then return nil end
  return s
end

local function makeAuthKey(playerName, identifiers)
  if identifiers and identifiers.beammp and identifiers.beammp ~= "" then
    return "beammp:" .. tostring(identifiers.beammp)
  end
  if identifiers and identifiers.ip and identifiers.ip ~= "" then
    return "ip:" .. tostring(identifiers.ip)
  end
  return "name:" .. tostring(playerName or "unknown")
end

local function buildSessionId(playerId, playerName, identifiers, joinedAt)
  local stable = "unknown"
  if identifiers and identifiers.beammp and identifiers.beammp ~= "" then
    stable = tostring(identifiers.beammp)
  elseif identifiers and identifiers.ip and identifiers.ip ~= "" then
    stable = tostring(identifiers.ip)
  else
    stable = tostring(playerName or "unknown")
  end
  stable = string.gsub(stable, "[^%w%-%._]", "_")
  return tostring(joinedAt) .. "-" .. tostring(playerId) .. "-" .. stable
end

local function cloneSession(session)
  return {
    sessionId = session.sessionId,
    playerId = session.playerId,
    playerName = session.playerName,
    joinedAt = session.joinedAt,
    leftAt = session.leftAt,
    durationMs = session.durationMs,
    ipAddress = session.ipAddress,
    beammpId = session.beammpId,
    discordId = session.discordId,
    role = session.role,
    isGuest = session.isGuest,
    authAt = session.authAt,
    lastSeenAt = session.lastSeenAt,
    endReason = session.endReason,
  }
end

local function normalizeLoadedSession(raw)
  if type(raw) ~= "table" or not raw.joinedAt then return nil end
  return {
    sessionId = safeStr(raw.sessionId) or buildSessionId(raw.playerId or -1, raw.playerName or "Unknown Player", { beammp = raw.beammpId, ip = raw.ipAddress or raw.ip }, raw.joinedAt),
    playerId = tonumber(raw.playerId) or nil,
    playerName = safeStr(raw.playerName) or "Unknown Player",
    joinedAt = tonumber(raw.joinedAt) or nowMs(),
    leftAt = tonumber(raw.leftAt) or nil,
    durationMs = tonumber(raw.durationMs) or 0,
    ipAddress = safeStr(raw.ipAddress) or safeStr(raw.ip),
    beammpId = safeStr(raw.beammpId),
    discordId = safeStr(raw.discordId),
    role = safeStr(raw.role),
    isGuest = raw.isGuest == true,
    authAt = tonumber(raw.authAt) or nil,
    lastSeenAt = tonumber(raw.lastSeenAt) or nil,
    endReason = safeStr(raw.endReason),
  }
end

local function loadAnalyticsState()
  local f = io.open(analyticsFile, "r")
  if not f then return end
  local raw = f:read("*a")
  f:close()
  if not raw or raw == "" then return end
  local ok, decoded = pcall(Util.JsonDecode, raw)
  if not ok or type(decoded) ~= "table" then
    print(TAG .. "WARNING: Failed to decode " .. analyticsFile .. "; starting fresh")
    return
  end
  if type(decoded.completedSessions) == "table" then
    for _, entry in ipairs(decoded.completedSessions) do
      local session = normalizeLoadedSession(entry)
      if session then table.insert(completedSessions, session) end
    end
  end
end

local function writeAnalytics()
  local activeList = {}
  for _, session in pairs(activeSessions) do
    table.insert(activeList, cloneSession(session))
  end
  table.sort(activeList, function(a, b)
    return (a.joinedAt or 0) > (b.joinedAt or 0)
  end)
  local payload = {
    version = ANALYTICS_VERSION,
    updatedAt = nowMs(),
    activeSessions = activeList,
    completedSessions = completedSessions,
  }
  local encoded = Util.JsonEncode(payload)
  local f = io.open(analyticsFile, "w")
  if not f then
    print(TAG .. "ERROR: Failed to open " .. analyticsFile .. " for writing")
    return
  end
  f:write(encoded)
  f:close()
end

local function cachePendingAuth(playerName, role, isGuest, identifiers)
  local key = makeAuthKey(playerName, identifiers)
  pendingAuth[key] = {
    playerName = safeStr(playerName) or "Unknown Player",
    role = safeStr(role),
    isGuest = isGuest == true,
    authAt = nowMs(),
    ipAddress = identifiers and safeStr(identifiers.ip) or nil,
    beammpId = identifiers and safeStr(identifiers.beammp) or nil,
    discordId = identifiers and safeStr(identifiers.discord) or nil,
  }
end

local function finalizeSession(playerId, endReason, explicitName)
  local session = activeSessions[playerId]
  if not session then return nil end
  local finishedAt = nowMs()
  session.playerName = safeStr(explicitName) or session.playerName
  session.leftAt = finishedAt
  session.lastSeenAt = finishedAt
  session.durationMs = math.max(0, finishedAt - (session.joinedAt or finishedAt))
  session.endReason = endReason
  table.insert(completedSessions, cloneSession(session))
  while #completedSessions > MAX_COMPLETED_SESSIONS do
    table.remove(completedSessions, 1)
  end
  activeSessions[playerId] = nil
  writeAnalytics()
  return session
end

print(TAG .. "Position tracker plugin loading...")
print(TAG .. "Output file: " .. posFile)
print(TAG .. "Analytics file: " .. analyticsFile)
print(TAG .. "Poll interval: 500ms")

loadAnalyticsState()

MP.RegisterEvent("onPlayerAuth", "handlePlayerAuth")
MP.RegisterEvent("onPlayerJoin", "handlePlayerJoin")
MP.RegisterEvent("onPlayerDisconnect", "handlePlayerDisconnect")
MP.RegisterEvent("onVehicleDeleted", "handleVehicleDeleted")
MP.RegisterEvent("onVehicleSpawn", "handleVehicleSpawn")
MP.CreateEventTimer("writePositions", 500)
MP.RegisterEvent("writePositions", "writePositions")

print(TAG .. "Events registered: onPlayerAuth, onPlayerJoin, onVehicleSpawn, onVehicleDeleted, onPlayerDisconnect, writePositions")
print(TAG .. "Timer registered: writePositions (500ms)")

-- Track which vehicles belong to which player for cleanup
local playerVehicles = {}

function handlePlayerAuth(player_name, player_role, is_guest, identifiers)
  cachePendingAuth(player_name, player_role, is_guest, identifiers)
  local ip = identifiers and safeStr(identifiers.ip) or "unknown"
  local beammp = identifiers and safeStr(identifiers.beammp) or "n/a"
  print(TAG .. "Player auth: " .. tostring(player_name) .. " (ip=" .. tostring(ip) .. ", beammp=" .. tostring(beammp) .. ")")
end

function handlePlayerJoin(player_id)
  local joinedAt = nowMs()
  local name = MP.GetPlayerName(player_id) or ("Player " .. tostring(player_id))
  local identifiers = MP.GetPlayerIdentifiers(player_id) or {}
  local auth = pendingAuth[makeAuthKey(name, identifiers)] or {}
  if activeSessions[player_id] then
    finalizeSession(player_id, "rejoined", name)
  end
  local role = nil
  if MP.GetPlayerRole then role = MP.GetPlayerRole(player_id) end
  activeSessions[player_id] = {
    sessionId = buildSessionId(player_id, name, identifiers, joinedAt),
    playerId = player_id,
    playerName = name,
    joinedAt = joinedAt,
    leftAt = nil,
    durationMs = 0,
    ipAddress = safeStr(identifiers.ip) or auth.ipAddress,
    beammpId = safeStr(identifiers.beammp) or auth.beammpId,
    discordId = safeStr(identifiers.discord) or auth.discordId,
    role = safeStr(role) or auth.role,
    isGuest = MP.IsPlayerGuest and MP.IsPlayerGuest(player_id) or auth.isGuest or false,
    authAt = auth.authAt,
    lastSeenAt = joinedAt,
    endReason = nil,
  }
  writeAnalytics()
  print(TAG .. "Player joined: " .. name .. " (pid=" .. tostring(player_id) .. ", ip=" .. tostring(activeSessions[player_id].ipAddress or "unknown") .. ")")
end

function handleVehicleSpawn(player_id, vehicle_id, data)
  if not playerVehicles[player_id] then playerVehicles[player_id] = {} end
  playerVehicles[player_id][vehicle_id] = true
  local name = MP.GetPlayerName(player_id) or ("Player " .. tostring(player_id))
  print(TAG .. "Vehicle spawned: " .. name .. " (pid=" .. tostring(player_id) .. ", vid=" .. tostring(vehicle_id) .. ")")
end

function handleVehicleDeleted(player_id, vehicle_id)
  if playerVehicles[player_id] then
    playerVehicles[player_id][vehicle_id] = nil
  end
  print(TAG .. "Vehicle deleted: pid=" .. tostring(player_id) .. ", vid=" .. tostring(vehicle_id))
end

function handlePlayerDisconnect(player_id)
  local name = MP.GetPlayerName(player_id) or ("Player " .. tostring(player_id))
  local vehCount = 0
  if playerVehicles[player_id] then
    for _ in pairs(playerVehicles[player_id]) do vehCount = vehCount + 1 end
  end
  playerVehicles[player_id] = nil
  local finished = finalizeSession(player_id, "disconnect", name)
  if finished then
    print(TAG .. "Player disconnected: " .. finished.playerName .. " (pid=" .. tostring(player_id) .. ", ip=" .. tostring(finished.ipAddress or "unknown") .. ", stayed=" .. tostring(finished.durationMs) .. "ms, vehicles cleaned: " .. vehCount .. ")")
  else
    print(TAG .. "Player disconnected: " .. name .. " (pid=" .. tostring(player_id) .. ", vehicles cleaned: " .. vehCount .. ")")
  end
end

function writePositions()
  local allPos = {}
  local players = MP.GetPlayers()
  local playerCount = 0
  local vehicleCount = 0
  local posErrors = 0
  for pid, name in pairs(players) do
    playerCount = playerCount + 1
    if activeSessions[pid] then
      activeSessions[pid].playerName = name
      activeSessions[pid].lastSeenAt = nowMs()
    end
    local ok, vehicles = pcall(MP.GetPlayerVehicles, pid)
    if ok and vehicles then
      for vid, _ in pairs(vehicles) do
        vehicleCount = vehicleCount + 1
        local okPos, raw, err = pcall(MP.GetPositionRaw, pid, vid)
        if okPos and err == "" and raw and raw.pos then
          local speed = 0
          if raw.vel then
            local vx, vy, vz = raw.vel[1] or 0, raw.vel[2] or 0, raw.vel[3] or 0
            speed = math.sqrt(vx * vx + vy * vy + vz * vz)
          end
          table.insert(allPos, {
            playerId = pid,
            playerName = name,
            vehicleId = vid,
            x = raw.pos[1] or 0,
            y = raw.pos[2] or 0,
            z = raw.pos[3] or 0,
            heading = 0,
            speed = speed,
            timestamp = os.time()
          })
        else
          posErrors = posErrors + 1
          if not okPos and writeCount % 60 == 0 then
            print(TAG .. "WARNING: GetPositionRaw failed for pid=" .. tostring(pid) .. ", vid=" .. tostring(vid) .. ": " .. tostring(raw))
          end
        end
      end
    elseif not ok then
      print(TAG .. "WARNING: Failed to get vehicles for pid=" .. tostring(pid) .. ": " .. tostring(vehicles))
    end
  end

  -- Log when player count changes
  if playerCount ~= lastPlayerCount then
    print(TAG .. "Tracking " .. playerCount .. " player(s), " .. vehicleCount .. " vehicle(s)")
    lastPlayerCount = playerCount
  end

  -- Log position errors periodically (every 60 writes = ~30s)
  writeCount = writeCount + 1
  if posErrors > 0 and writeCount % 60 == 0 then
    print(TAG .. "WARNING: " .. posErrors .. " position read error(s) this tick")
  end

  local json = Util.JsonEncode(allPos)
  local wrotePath = nil
  local f = io.open(posFile, "w")
  if f then
    f:write(json)
    f:close()
    wrotePath = posFile
  else
    local f2 = io.open(posFileFallback, "w")
    if f2 then
      f2:write(json)
      f2:close()
      wrotePath = posFileFallback
    end
  end

  if (not wrotePath) and writeCount % 60 == 0 then
    print(TAG .. "ERROR: Failed to open both " .. posFile .. " and " .. posFileFallback .. " for writing")
  end
end

writeAnalytics()

print(TAG .. "Plugin loaded successfully")
`
}

function buildBanEnforcerPlugin(serverDir: string): string {
  // Minimal IP ban enforcer — independent of analytics/tracker
  const ipMetaPath = serverDir.replace(/\\/g, '/') + '/ip_meta.json'
  return `-- BeamMPCM IP Ban Enforcer Plugin
-- Auto-deployed by BeamMP Content Manager
-- Enforces IP-based bans from ip_meta.json

local TAG = "[BeamCM-Bans] "
local banMetaFile = "${ipMetaPath}"
local bannedIPs = {}

local function loadBanList()
  bannedIPs = {}
  local f = io.open(banMetaFile, "r")
  if not f then return end
  local raw = f:read("*a")
  f:close()
  if not raw or raw == "" then return end
  local ok, decoded = pcall(Util.JsonDecode, raw)
  if not ok or type(decoded) ~= "table" then
    print(TAG .. "WARNING: Failed to decode " .. banMetaFile)
    return
  end
  for ip, meta in pairs(decoded) do
    if type(meta) == "table" and meta.banned == true then
      bannedIPs[ip] = true
    end
  end
  print(TAG .. "Loaded " .. tostring(#bannedIPs) .. " banned IP(s)")
end

print(TAG .. "IP ban enforcer loading...")
print(TAG .. "Ban list file: " .. banMetaFile)

loadBanList()

MP.RegisterEvent("onPlayerAuth", "handlePlayerAuth")

function handlePlayerAuth(player_name, player_role, is_guest, identifiers)
  local ip = identifiers and identifiers.ip or nil
  if ip and bannedIPs[ip] then
    print(TAG .. "Rejecting banned IP: " .. tostring(ip) .. " (player: " .. tostring(player_name) .. ")")
    return "You are banned from this server."
  end
end

print(TAG .. "Plugin loaded successfully")
`
}
