import { readFile, writeFile, mkdir, readdir, unlink, stat, copyFile, rm, chmod } from 'fs/promises'
import { existsSync, createWriteStream } from 'fs'
import { join, basename, dirname } from 'path'
import { app, BrowserWindow, safeStorage } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { get as httpsGet } from 'https'
import { open as yauzlOpen, type Entry } from 'yauzl'
import { isModArchive, stripArchiveExt } from '../utils/archiveConverter'
import type {
  HostedServerConfig,
  HostedServerStatus,
  HostedServerState,
  HostedServerEntry,
  ServerFileEntry,
  GPSRoute,
  PlayerPosition
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
  debug: false
}

interface RunningServer {
  process: ChildProcess
  state: HostedServerState
  startedAt: number
  players: number
  error: string | null
  consoleBuffer: string[]
}

const MAX_CONSOLE_LINES = 2000

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
  private exePath: string | null = null
  private downloading = false
  private customExeResolver: (() => string | null) | null = null

  constructor() {
    const base = join(app.getPath('appData'), 'BeamMP-ContentManager')
    this.serversDir = join(base, 'servers')
    this.binDir = join(base, 'bin')
  }

  /** Set a callback that returns the custom server exe path from config (or null for default) */
  setCustomExeResolver(resolver: () => string | null): void {
    this.customExeResolver = resolver
  }

  /** Resolve the effective exe path: custom override > built-in managed copy */
  private resolveExePath(): string | null {
    const custom = this.customExeResolver?.()
    if (custom && existsSync(custom)) return custom
    return this.exePath
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
        size: s?.size ?? 0
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
    if (!resolved.startsWith(serverDir)) {
      throw new Error('Access denied: path outside server directory')
    }
    return resolved
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
    const posPath = join(this.serversDir, id, 'player_positions.json')
    if (!existsSync(posPath)) return []
    try {
      const raw = await readFile(posPath, 'utf-8')
      return JSON.parse(raw)
    } catch {
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
    if (!existsSync(pluginPath)) {
      await writeFile(pluginPath, TRACKER_LUA_PLUGIN, 'utf-8')
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
    return config
  }

  async updateServer(id: string, partial: Partial<HostedServerConfig>): Promise<HostedServerConfig> {
    const dir = join(this.serversDir, id)
    const raw = await readFile(join(dir, 'server.json'), 'utf-8')
    const config: HostedServerConfig = { ...this.deserializeConfig(raw), ...partial, id }
    await writeFile(join(dir, 'server.json'), this.serializeConfig(config), 'utf-8')
    await this.writeToml(config)
    return config
  }

  async deleteServer(id: string): Promise<void> {
    if (this.running.has(id)) {
      this.stopServer(id)
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

    // Ensure this server has its own exe copy
    const localExe = this.serverExePath(id)
    if (!existsSync(localExe)) {
      await copyFile(effectiveExe, localExe)
      await this.makeExecutable(localExe)
    }

    const serverDir = join(this.serversDir, id)
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
      consoleBuffer: []
    }
    this.running.set(id, entry)

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
        // Player count detection
        const playerMatch = line.match(/Players: (\d+)\//)
        if (playerMatch) {
          entry.players = parseInt(playerMatch[1], 10)
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

    this.emitStatusChange(id)
    return { success: true }
  }

  stopServer(id: string): void {
    const entry = this.running.get(id)
    if (!entry) return
    entry.state = 'stopped'
    entry.process.kill()
    this.running.delete(id)
    this.emitStatusChange(id)
  }

  async restartServer(id: string): Promise<{ success: boolean; error?: string }> {
    this.stopServer(id)
    // Small delay for port release
    await new Promise((r) => setTimeout(r, 1000))
    return this.startServer(id)
  }

  getStatus(id: string): HostedServerStatus {
    const entry = this.running.get(id)
    if (!entry) {
      return { id, state: 'stopped', pid: null, uptimeMs: 0, startedAt: null, players: 0, error: null }
    }
    return {
      id,
      state: entry.state,
      pid: entry.process.pid ?? null,
      uptimeMs: Date.now() - entry.startedAt,
      startedAt: entry.startedAt,
      players: entry.players,
      error: entry.error
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

/* ── BeamMPCM Tracker Lua Plugin ── */
const TRACKER_LUA_PLUGIN = `-- BeamMPCM Position Tracker Plugin
-- Auto-deployed by BeamMP Content Manager
-- Writes player vehicle positions to player_positions.json

local posFile = "player_positions.json"
local positions = {}

MP.RegisterEvent("onVehicleSpawn", "handleVehicleSpawn")
MP.RegisterEvent("onVehicleEdited", "handleVehicleEdited")
MP.RegisterEvent("onVehicleDeleted", "handleVehicleDeleted")
MP.RegisterEvent("onPlayerDisconnect", "handlePlayerDisconnect")
MP.CreateEventTimer("writePositions", 500)

function handleVehicleSpawn(player_id, vehicle_id, data)
  local name = MP.GetPlayerName(player_id) or ("Player " .. tostring(player_id))
  if not positions[player_id] then positions[player_id] = {} end
  positions[player_id][vehicle_id] = {
    playerId = player_id,
    playerName = name,
    vehicleId = vehicle_id,
    x = 0, y = 0, z = 0,
    heading = 0,
    speed = 0,
    timestamp = os.time()
  }
end

function handleVehicleEdited(player_id, vehicle_id, data)
  if not positions[player_id] then positions[player_id] = {} end
  local name = MP.GetPlayerName(player_id) or ("Player " .. tostring(player_id))
  local pos = {0, 0, 0}
  if type(data) == "string" then
    local ok, parsed = pcall(function() return Util.JsonDecode(data) end)
    if ok and parsed and parsed.pos then
      pos = {parsed.pos[1] or 0, parsed.pos[2] or 0, parsed.pos[3] or 0}
    end
  end
  positions[player_id][vehicle_id] = {
    playerId = player_id,
    playerName = name,
    vehicleId = vehicle_id,
    x = pos[1], y = pos[2], z = pos[3],
    heading = 0,
    speed = 0,
    timestamp = os.time()
  }
end

function handleVehicleDeleted(player_id, vehicle_id)
  if positions[player_id] then
    positions[player_id][vehicle_id] = nil
  end
end

function handlePlayerDisconnect(player_id)
  positions[player_id] = nil
end

function writePositions()
  local allPos = {}
  for _, vehicles in pairs(positions) do
    for _, data in pairs(vehicles) do
      table.insert(allPos, data)
    end
  end
  local json = Util.JsonEncode(allPos)
  local f = io.open(posFile, "w")
  if f then
    f:write(json)
    f:close()
  end
end
`
