import { spawn, ChildProcess, execSync } from 'child_process'
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  createReadStream,
  readdirSync
} from 'fs'
import { join, extname, basename } from 'path'
import {
  createServer as createHttpServer,
  IncomingMessage,
  ServerResponse
} from 'http'
import { request as httpsRequest } from 'https'
import type { Server as HttpServer } from 'http'
import * as net from 'net'
import * as dgram from 'dgram'
import * as zlib from 'zlib'
import { createHash } from 'crypto'
import { homedir } from 'os'
import { app, BrowserWindow, safeStorage } from 'electron'
import type { GamePaths, GameStatus } from '../../shared/types'

interface ModInfo {
  file_name: string
  file_size: number
  hash: string
  hash_algorithm: string
  protected?: boolean
}

const LAUNCHER_VERSION = '2.8.0'

// Lua bridge extension deployed into BeamNG as a mod ZIP to properly initiate server connections
const BRIDGE_LUA = `
local M = {}
local signalFile = "settings/BeamMP/cm_join.json"
local pollInterval = 0.25
local timer = 0
local joined = false

local function onExtensionLoaded()
  log('I', 'beammpCMBridge', 'BeamMP Content Manager bridge extension loaded')
end

-- ── GPS tracker hot-load support ──
local gpsSignalFile = "settings/BeamCM/gps_signal.json"
local gpsPollInterval = 0.5
local gpsTimer = 0
local gpsLoaded = false

local function pollGpsSignal(dt)
  gpsTimer = gpsTimer + dt
  if gpsTimer < gpsPollInterval then return end
  gpsTimer = 0
  local sig = jsonReadFile(gpsSignalFile)
  if not sig or sig.processed then return end
  jsonWriteFile(gpsSignalFile, {action = sig.action, processed = true})
  if sig.action == "load" and not gpsLoaded then
    log('I', 'beammpCMBridge', 'Hot-loading GPS tracker extension')
    extensions.load('beamcmGPS')
    gpsLoaded = true
  elseif sig.action == "unload" and gpsLoaded then
    log('I', 'beammpCMBridge', 'Unloading GPS tracker extension')
    extensions.unload('beamcmGPS')
    gpsLoaded = false
  end
end

local function onUpdate(dt)
  -- GPS hot-load polling always runs
  pollGpsSignal(dt)

  if joined then return end
  timer = timer + dt
  if timer < pollInterval then return end
  timer = 0
  local content = jsonReadFile(signalFile)
  if not content or content.processed then return end
  if not content.ip or not content.port then return end
  jsonWriteFile(signalFile, {processed = true})
  joined = true
  log('I', 'beammpCMBridge', 'CM join signal: ' .. content.ip .. ':' .. tostring(content.port))
  if extensions.MPCoreNetwork and extensions.MPCoreNetwork.connectToServer then
    -- Navigate to the BeamMP multiplayer menu so the loading overlay is visible
    guihooks.trigger('MenuOpenModule', 'multiplayer')
    -- Show immediate loading feedback
    guihooks.trigger('LoadingInfo', {message = 'Connecting to server...'})
    log('I', 'beammpCMBridge', 'Calling MPCoreNetwork.connectToServer')
    extensions.MPCoreNetwork.connectToServer(content.ip, tonumber(content.port), "", content.name or "")
  else
    log('E', 'beammpCMBridge', 'MPCoreNetwork not available - is BeamMP mod loaded?')
    joined = false
  end
end

M.onExtensionLoaded = onExtensionLoaded
M.onUpdate = onUpdate
return M
`

// Lua bridge for singleplayer launches — deployed as an unpacked mod so BeamNG loads
// it automatically. Reads a signal file and auto-loads the requested level + vehicle.
const VANILLA_BRIDGE_LUA = `
local M = {}
local signalFile = "settings/BeamCM/launch_signal.json"
local pollInterval = 0.5
local timer = 0
local acted = false
local pendingVehicle = nil
local startupDelay = 3
local startupTimer = 0
local ready = false

local function onExtensionLoaded()
  log('I', 'beamcmBridge', 'BeamCM singleplayer bridge loaded')
end

local function onUpdate(dt)
  if acted then return end
  -- Wait a few seconds after game start so the engine is fully ready
  if not ready then
    startupTimer = startupTimer + dt
    if startupTimer < startupDelay then return end
    ready = true
  end
  timer = timer + dt
  if timer < pollInterval then return end
  timer = 0
  local content = jsonReadFile(signalFile)
  if not content or content.processed then return end
  jsonWriteFile(signalFile, {processed = true})
  acted = true
  local mode = content.mode or "freeroam"
  log('I', 'beamcmBridge', 'CM launch signal: mode=' .. mode)
  if content.vehicle then pendingVehicle = content.vehicle end
  if mode == "freeroam" then
    local level = content.level or "gridmap_v2/info.json"
    log('I', 'beamcmBridge', 'Loading level: ' .. level)
    if core_levels and core_levels.startLevel then
      core_levels.startLevel(level)
    end
  else
    -- For game-mode screens, try to navigate via the UI system
    log('I', 'beamcmBridge', 'Navigating to game mode: ' .. mode)
    local modeMap = {
      campaigns    = "/menu/campaigns",
      scenarios    = "/menu/scenarios",
      challenges   = "/menu/challenges",
      rally        = "/menu/rally",
      timeTrials   = "/menu/timeTrials",
      busRoutes    = "/menu/busRoutes",
      lightRunner  = "/menu/lightRunner",
      trackBuilder = "/menu/trackBuilder",
      garage       = "/menu/garage",
      replays      = "/menu/replays",
      stats        = "/menu/stats"
    }
    local path = modeMap[mode]
    if path and guihooks and guihooks.trigger then
      guihooks.trigger('MenuOpenModule', path)
    end
  end
end

local function onClientStartMission()
  if not pendingVehicle then return end
  local veh = pendingVehicle
  pendingVehicle = nil
  log('I', 'beamcmBridge', 'Spawning vehicle: ' .. veh)
  if core_vehicles and core_vehicles.replaceVehicle then
    core_vehicles.replaceVehicle(veh, {})
  end
end

-- ── GPS tracker hot-load support ──
local gpsSignalFile = "settings/BeamCM/gps_signal.json"
local gpsPollInterval = 0.5
local gpsTimer = 0
local gpsLoaded = false

local function pollGpsSignal(dt)
  gpsTimer = gpsTimer + dt
  if gpsTimer < gpsPollInterval then return end
  gpsTimer = 0
  local sig = jsonReadFile(gpsSignalFile)
  if not sig or sig.processed then return end
  jsonWriteFile(gpsSignalFile, {action = sig.action, processed = true})
  if sig.action == "load" and not gpsLoaded then
    log('I', 'beamcmBridge', 'Hot-loading GPS tracker extension')
    extensions.load('beamcmGPS')
    gpsLoaded = true
  elseif sig.action == "unload" and gpsLoaded then
    log('I', 'beamcmBridge', 'Unloading GPS tracker extension')
    extensions.unload('beamcmGPS')
    gpsLoaded = false
  end
end

local origOnUpdate = onUpdate
local function onUpdateWithGps(dt)
  origOnUpdate(dt)
  pollGpsSignal(dt)
end

M.onExtensionLoaded = onExtensionLoaded
M.onUpdate = onUpdateWithGps
M.onClientStartMission = onClientStartMission
return M
`

// ── GPS Tracker Lua scripts ──

// GE extension: reads vehicle position each frame and writes it to a JSON file for the Content Manager
const GPS_TRACKER_GE_LUA = `
local M = {}
local telemetryFile = "settings/BeamCM/gps_telemetry.json"
local sendInterval = 0.05 -- 20 Hz
local timer = 0

local function onExtensionLoaded()
  log('I', 'beamcmGPS', 'BeamCM GPS tracker extension loaded')
end

local function onExtensionUnloaded()
  log('I', 'beamcmGPS', 'BeamCM GPS tracker extension unloaded')
end

local function getOtherVehicles(myVeh)
  local others = {}
  local count = be:getObjectCount()
  for i = 0, count - 1 do
    local obj = be:getObject(i)
    if obj and obj ~= myVeh then
      local p = obj:getPosition()
      local d = obj:getDirectionVector()
      local v = obj:getVelocity()
      local name = ""
      -- Try to get player name from BeamMP if available
      if MPVehicleGE and MPVehicleGE.getVehicleByGameID then
        local mpData = MPVehicleGE.getVehicleByGameID(obj:getID())
        if mpData and mpData.ownerName then
          name = mpData.ownerName
        end
      end
      table.insert(others, {
        x = p.x, y = p.y, z = p.z,
        heading = math.atan2(d.x, d.y),
        speed = v:length(),
        name = name
      })
    end
  end
  return others
end

local function getNavRoute()
  -- Read the active GPS navigation route from core_groundMarkers
  if not core_groundMarkers or not core_groundMarkers.currentlyHasTarget or not core_groundMarkers.currentlyHasTarget() then
    return nil
  end
  local rp = core_groundMarkers.routePlanner
  if not rp or not rp.path or #rp.path == 0 then return nil end
  -- Sample the route: take every Nth point to keep the JSON manageable
  local route = {}
  local step = math.max(1, math.floor(#rp.path / 200))
  for i = 1, #rp.path, step do
    local node = rp.path[i]
    if node and node.pos then
      table.insert(route, {x = node.pos.x, y = node.pos.y})
    end
  end
  -- Always include the final destination
  local last = rp.path[#rp.path]
  if last and last.pos and (#route == 0 or route[#route].x ~= last.pos.x or route[#route].y ~= last.pos.y) then
    table.insert(route, {x = last.pos.x, y = last.pos.y})
  end
  return route
end

local function onUpdate(dt)
  timer = timer + dt
  if timer < sendInterval then return end
  timer = 0
  local veh = be:getPlayerVehicle(0)
  if not veh then return end
  local pos = veh:getPosition()
  local vel = veh:getVelocity()
  local dir = veh:getDirectionVector()
  local heading = math.atan2(dir.x, dir.y)
  local speed = vel:length()
  local levelName = ""
  if getMissionFilename then
    levelName = getMissionFilename() or ""
  end
  if (levelName == "" or levelName == "unknown") and getCurrentLevelIdentifier then
    levelName = getCurrentLevelIdentifier() or ""
  end
  jsonWriteFile(telemetryFile, {
    x = pos.x,
    y = pos.y,
    z = pos.z,
    heading = heading,
    speed = speed,
    map = levelName,
    others = getOtherVehicles(veh),
    route = getNavRoute(),
    t = os.clock()
  })
end

M.onExtensionLoaded = onExtensionLoaded
M.onExtensionUnloaded = onExtensionUnloaded
M.onUpdate = onUpdate
return M
`

// CRC-32 lookup table (standard polynomial 0xEDB88320)
const CRC32_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  }
  CRC32_TABLE[i] = c >>> 0
}

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

export class GameLauncherService {
  private gameProcess: ChildProcess | null = null
  private coreServer: net.Server | null = null
  private coreSocket: net.Socket | null = null
  private httpProxy: HttpServer | null = null
  private httpProxyPort: number = 0
  private corePort: number = 4444
  private statusListeners: Array<(status: GameStatus) => void> = []

  // Auth state
  private loginAuth: boolean = false
  private username: string = ''
  private userRole: string = ''
  private userId: number = -1
  publicKey: string = ''
  private privateKey: string = ''

  // Server connection state
  private connectedServerAddress: string | null = null
  private serverSocket: net.Socket | null = null
  private gameProxyServer: net.Server | null = null
  private gameProxySocket: net.Socket | null = null
  private ulStatus: string = 'Ulstart'
  private mStatus: string = ' '
  private cachedModList: string = ''
  private preSyncActive: boolean = false
  private ping: number = -1
  private terminate: boolean = false
  private terminateReason: string = ''
  private confList: Set<string> = new Set()
  private clientId: number = -1
  private magic: Buffer | null = null

  // Game paths
  private gameUserDir: string = ''
  private cachingDirectory: string = ''

  // Buffer for TCP framing on core socket
  private coreRecvBuffer: Buffer = Buffer.alloc(0)

  // Server TCP handshake state
  private serverBuffer: Buffer = Buffer.alloc(0)
  private serverMsgResolve: ((msg: string) => void) | null = null
  private serverRawResolve: ((data: Buffer) => void) | null = null
  private serverRawSize: number = 0
  private serverRawBuffer: Buffer | null = null
  private serverRawOffset: number = 0
  private serverRawProgressCallback: ((received: number) => void) | null = null
  private serverInRelay: boolean = false

  // UDP
  private udpSocket: dgram.Socket | null = null
  private udpTarget: { ip: string; port: number } | null = null
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private pingStart: number = 0

  // Pending server address for delayed H / UDP start (sent when game connects to proxy)
  private pendingRelayServer: { ip: string; port: number } | null = null

  // Game readiness tracking
  private gameInitialized: boolean = false
  private gameReadyResolve: (() => void) | null = null
  private pendingServerJoin: { ip: string; port: number } | null = null

  // Log buffer for UI
  private logBuffer: string[] = []
  private readonly maxLogLines: number = 2000
  private backendUrlResolver: (() => string) | null = null
  private authUrlResolver: (() => string) | null = null

  // GPS tracker
  private gpsFilePoller: ReturnType<typeof setInterval> | null = null
  private gpsTrackerDeployed: boolean = false
  private latestGpsTelemetry: import('../../shared/types').GPSTelemetry | null = null

  /** Set a callback that returns the configured backend URL */
  setBackendUrlResolver(resolver: () => string): void {
    this.backendUrlResolver = resolver
  }

  /** Set a callback that returns the configured auth URL */
  setAuthUrlResolver(resolver: () => string): void {
    this.authUrlResolver = resolver
  }

  /** Resolve the backend base URL (without trailing slash) */
  private get backendUrl(): string {
    const url = this.backendUrlResolver?.() || 'https://backend.beammp.com'
    return url.replace(/\/+$/, '')
  }

  /** Resolve the auth base URL (without trailing slash) */
  private get authUrl(): string {
    const url = this.authUrlResolver?.() || 'https://auth.beammp.com'
    return url.replace(/\/+$/, '')
  }

  /** Set terminate flag with a specific human-readable reason */
  private terminateWith(reason: string): void {
    this.terminate = true
    if (!this.terminateReason) this.terminateReason = reason
    this.log(`Terminate: ${reason}`)
  }

  /** Parse a BeamMP server E/K error message into a human-readable string */
  private parseServerError(raw: string, fallback: string): string {
    if (!raw || raw.length < 2) return fallback
    const code = raw[0]
    const msg = raw.substring(1).trim()
    if (code === 'K') {
      return msg ? `Kicked by server: ${msg}` : 'Kicked by server'
    }
    // E prefix — various server errors
    const lower = msg.toLowerCase()
    if (lower.includes('full')) return 'Server is full'
    if (lower.includes('ban')) return `Banned from server: ${msg}`
    if (lower.includes('auth') || lower.includes('invalid key') || lower.includes('not authenticated')) {
      return `Authentication failed: ${msg}`
    }
    if (lower.includes('version') || lower.includes('outdated') || lower.includes('update')) {
      return `Version mismatch: ${msg}`
    }
    if (lower.includes('whitelist')) return `Not on server whitelist: ${msg}`
    if (lower.includes('timeout')) return 'Connection timed out'
    return msg || fallback
  }

  private log(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}`
    console.log(`[BeamMP] ${message}`)
    this.logBuffer.push(line)
    if (this.logBuffer.length > this.maxLogLines) {
      this.logBuffer.splice(0, this.logBuffer.length - this.maxLogLines)
    }
    this.emitLauncherLog(line)
  }

  private emitLauncherLog(line: string): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('launcher:log', line)
    }
  }

  private emitModSyncProgress(progress: {
    phase: 'downloading' | 'loading' | 'done'
    modIndex: number
    modCount: number
    fileName: string
    received: number
    total: number
  }): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) win.webContents.send('game:modSyncProgress', progress)
    }
  }

  getLogs(): string[] {
    return [...this.logBuffer]
  }

  getLauncherVersion(): string {
    return LAUNCHER_VERSION
  }

  constructor() {
    this.cachingDirectory = join(app.getPath('userData'), 'Resources')
    this.loadSavedKey()
  }

  getStatus(): GameStatus {
    return {
      running: this.gameProcess !== null && !this.gameProcess.killed,
      pid: this.gameProcess?.pid ?? null,
      connectedServer: this.connectedServerAddress
    }
  }

  onStatusChange(listener: (status: GameStatus) => void): void {
    this.statusListeners.push(listener)
  }

  private notifyStatusChange(): void {
    const status = this.getStatus()
    for (const listener of this.statusListeners) {
      listener(status)
    }
  }

  // ── Key persistence ──

  private getKeyPath(): string {
    return join(app.getPath('userData'), 'key')
  }

  private loadSavedKey(): void {
    try {
      const keyPath = this.getKeyPath()
      if (!existsSync(keyPath)) return
      const raw = readFileSync(keyPath)

      // Try decrypting (encrypted keys are binary, not valid UTF-8 starting with plain alphanum)
      if (safeStorage.isEncryptionAvailable()) {
        try {
          const decrypted = safeStorage.decryptString(raw)
          if (decrypted && /^[a-zA-Z0-9-]+$/.test(decrypted)) {
            this.privateKey = decrypted
            return
          }
        } catch {
          // Not encrypted — fall through to plaintext migration
        }
      }

      // Fallback: read as plaintext (legacy) and re-encrypt
      const plain = raw.toString('utf-8').trim()
      if (plain && /^[a-zA-Z0-9-]+$/.test(plain)) {
        this.privateKey = plain
        // Migrate: re-save encrypted
        this.saveKey(plain)
      }
    } catch {
      // ignore
    }
  }

  private saveKey(key: string | null): void {
    const keyPath = this.getKeyPath()
    if (key && /^[a-zA-Z0-9]/.test(key)) {
      this.privateKey = key
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(key)
        writeFileSync(keyPath, encrypted)
      } else {
        // Fallback if OS encryption unavailable
        writeFileSync(keyPath, key, 'utf-8')
      }
    } else {
      this.privateKey = ''
      try {
        if (existsSync(keyPath)) {
          unlinkSync(keyPath)
        }
      } catch {
        // ignore
      }
    }
  }

  // ── TCP Framing helpers ──

  private prependHeader(data: string): Buffer {
    const payload = Buffer.from(data, 'utf-8')
    const header = Buffer.alloc(4)
    header.writeUInt32LE(payload.length, 0)
    return Buffer.concat([header, payload])
  }

  private coreSend(data: string): void {
    if (this.coreSocket && !this.coreSocket.destroyed) {
      const buf = this.prependHeader(data)
      this.coreSocket.write(buf)
    }
  }

  // ── Compression helpers ──

  private decompressBuf(rawPayload: Buffer): string {
    if (
      rawPayload.length >= 4 &&
      rawPayload[0] === 0x41 &&
      rawPayload[1] === 0x42 &&
      rawPayload[2] === 0x47 &&
      rawPayload[3] === 0x3a
    ) {
      try {
        const decompressed = zlib.inflateSync(rawPayload.subarray(4))
        return decompressed.toString('utf-8')
      } catch (err) {
        this.log(`ERROR: Decompression failed: ${err}`)
        return rawPayload.toString('utf-8')
      }
    }
    return rawPayload.toString('utf-8')
  }

  // ── SHA-256 hash ──

  private hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256')
      const stream = createReadStream(filePath)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', reject)
    })
  }

  // ── Core TCP Server (port 4444) ──

  private startCoreServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.coreServer) {
        resolve()
        return
      }

      this.coreServer = net.createServer((socket) => {
        this.log('Game Connected!')
        this.coreSocket = socket
        this.coreRecvBuffer = Buffer.alloc(0)
        this.localReset()

        socket.on('data', (chunk) => {
          this.coreRecvBuffer = Buffer.concat([this.coreRecvBuffer, chunk])
          this.processCoreBuffer()
        })

        socket.on('close', () => {
          this.log('Game disconnected from Core')
          this.coreSocket = null
          this.netReset()
        })

        socket.on('error', (err) => {
          this.log(`ERROR: Core socket error: ${err.message}`)
          this.coreSocket = null
        })
      })

      this.coreServer.on('error', (err) => {
        this.log(`ERROR: Core server error: ${err}`)
        reject(err)
      })

      this.coreServer.listen(this.corePort, '127.0.0.1', () => {
        this.log(`Core Network on port: ${this.corePort}`)
        resolve()
      })
    })
  }

  private processCoreBuffer(): void {
    while (this.coreRecvBuffer.length >= 4) {
      const msgLen = this.coreRecvBuffer.readUInt32LE(0)
      if (this.coreRecvBuffer.length < 4 + msgLen) break

      const data = this.coreRecvBuffer.subarray(4, 4 + msgLen).toString('utf-8')
      this.coreRecvBuffer = this.coreRecvBuffer.subarray(4 + msgLen)

      this.parseCoreMessage(data)
    }
  }

  private parseCoreMessage(data: string): void {
    if (!data.length) return

    const code = data[0]
    const subCode = data.length > 1 ? data[1] : ''

    // Log core messages from game (skip A heartbeats, Ul polling, and frequent relay traffic)
    if (code !== 'A' && code !== 'E' && code !== 'O' && code !== 'V' && code !== 'W'
      && !(code === 'U' && subCode === 'l') && !(code === 'U' && subCode === 'p')) {
      this.log(`Core ← Game: ${code}${subCode} (${data.length} bytes)${data.length < 80 ? ' → ' + data : ''}`)
    }

    switch (code) {
      case 'A':
        // Ack — respond with just 'A'
        this.coreSend('A')
        break

      case 'B':
        // Server list request — fetch and send
        // Don't reset if we're actively connecting to or connected to a server
        if (this.pendingServerJoin || this.connectedServerAddress) {
          this.log('Skipping netReset on B — active connection/pending join')
        } else {
          this.netReset()
          this.terminate = true
        }
        this.fetchAndSendServerList()
        break

      case 'C':
        // Connect to server: C<ip:port>
        // If we're already connected/connecting (joinServerImpl pre-connected),
        // skip — the game just needs to connect to the proxy.
        if (this.preSyncActive && this.serverInRelay) {
          this.preSyncActive = false
          this.log('Pre-synced connection active, sending L to game and staging Uldone')
          // NOW send L to trigger the game's loading state machine.
          // We withheld it during pre-sync so the game wouldn't try to
          // mount/load the map before connectToServer was called.
          this.ulStatus = 'UlLoading...'
          this.coreSend('L' + this.cachedModList)
          // Delay Uldone to give the game time to mount mods via loadServerMods()
          // before it requests the map. Without this delay, expandMissionFileName()
          // fails for mod maps (e.g. freedom) because the zip hasn't been indexed yet.
          setTimeout(() => {
            this.ulStatus = 'Uldone'
          }, 3000)
        } else if (this.serverInRelay || (this.serverSocket && !this.serverSocket.destroyed)) {
          this.log('Already connected/connecting, re-sending L to game')
          this.coreSend('L' + this.cachedModList)
        } else {
          this.startServerSync(data)
        }
        break

      case 'I':
        // Server info query: I<ip:port>
        this.getServerInfo(data)
        break

      case 'N':
        // Auth
        if (subCode === 'c') {
          // Return cached auth info
          const authInfo: Record<string, unknown> = {
            Auth: this.loginAuth ? 1 : 0
          }
          if (this.username) authInfo.username = this.username
          if (this.userRole) authInfo.role = this.userRole
          if (this.userId !== -1) authInfo.id = this.userId
          this.coreSend('N' + JSON.stringify(authInfo))

          // Mark game as initialized after auth exchange
          if (!this.gameInitialized) {
            this.gameInitialized = true
            this.log('Game mod initialized (Nc auth completed)')
            if (this.gameReadyResolve) {
              this.gameReadyResolve()
              this.gameReadyResolve = null
            }
          }
        } else {
          // Login request: N<fields_after_colon>
          const colonIdx = data.indexOf(':')
          const fields = colonIdx >= 0 ? data.substring(colonIdx + 1) : ''
          this.handleLogin(fields)
        }
        break

      case 'O':
        // Open URL in browser — we just ignore or could use shell.openExternal
        break

      case 'P':
        // Game asks for HTTP proxy port — respond with P<httpProxyPort>
        // (official launcher does the same in Core.cpp Parse 'P' handler).
        if (this.httpProxyPort > 0) {
          this.coreSend('P' + this.httpProxyPort.toString())
        }
        break

      case 'Q':
        // Quit commands
        if (subCode === 'S') {
          // If we're in pre-sync, the game may send QS because it tried to process
          // a stale state. Ignore it to preserve the relay.
          if (this.preSyncActive && this.serverInRelay) {
            this.log('QS received during pre-sync — ignoring (relay preserved)')
          } else {
            this.netReset()
            this.terminate = true
            this.ping = -1
          }
        } else if (subCode === 'G') {
          // Game wants launcher to close — we stay open
        }
        break

      case 'R':
        // Mod loaded confirmation
        if (!this.confList.has(data)) {
          this.confList.add(data)
        }
        break

      case 'U':
        // Status query
        if (subCode === 'l') {
          this.coreSend(this.ulStatus)
        } else if (subCode === 'p') {
          const pingStr = this.ping > 800 ? '-2' : this.ping.toString()
          this.coreSend('Up' + pingStr)
        } else {
          const pingStr = this.ping > 800 ? '-2' : this.ping.toString()
          this.coreSend('Up' + pingStr)
        }
        break

      case 'M':
        // Map request from game — respond if we have the map
        if (this.mStatus !== ' ') {
          this.log('Game requested map, responding with cached map')
          this.coreSend(this.mStatus)
        } else {
          this.log('Game requested map but not received from server yet')
        }
        break

      case 'W':
        // Security warning confirmation (game auto-sends WY when skipModSecurityWarning is on)
        // We don't send WMODS_FOUND anymore, but handle WY/WN gracefully if received
        break

      case 'Z':
        // Version query
        this.coreSend('Z' + LAUNCHER_VERSION)
        break

      default:
        break
    }
  }

  // ── Server list fetch ──

  private async fetchAndSendServerList(): Promise<void> {
    try {
      const resp = await fetch(`${this.backendUrl}/servers-info`)
      const body = await resp.text()
      this.coreSend('B' + body)
    } catch (err) {
      this.log(`ERROR: Failed to fetch server list: ${err}`)
      this.coreSend('B[]')
    }
  }

  // ── Server info query ──

  private getServerInfo(data: string): void {
    // data = "I<ip:port>"
    const hostPort = data.substring(1)
    const colonIdx = hostPort.lastIndexOf(':')
    if (colonIdx < 0) {
      this.coreSend('I' + hostPort + ';')
      return
    }
    const ip = hostPort.substring(0, colonIdx)
    const port = parseInt(hostPort.substring(colonIdx + 1), 10)

    if (!port || port < 1 || port > 65535) {
      this.coreSend('I' + hostPort + ';')
      return
    }

    const sock = new net.Socket()
    sock.setTimeout(5000)
    sock.connect(port, ip, () => {
      // Send raw 'I' byte (no length prefix) per protocol
      sock.write(Buffer.from('I'))
    })

    let recvBuf = Buffer.alloc(0)
    sock.on('data', (chunk) => {
      recvBuf = Buffer.concat([recvBuf, chunk])
      if (recvBuf.length >= 4) {
        const len = recvBuf.readUInt32LE(0)
        if (recvBuf.length >= 4 + len) {
          const info = recvBuf.subarray(4, 4 + len).toString('utf-8')
          this.coreSend('I' + hostPort + ';' + info)
          sock.destroy()
        }
      }
    })

    sock.on('timeout', () => {
      this.coreSend('I' + hostPort + ';')
      sock.destroy()
    })

    sock.on('error', () => {
      this.coreSend('I' + hostPort + ';')
      sock.destroy()
    })
  }

  // ── Authentication ──

  private async handleLogin(fields: string): Promise<void> {
    if (fields === 'LO') {
      // Logout
      this.username = ''
      this.userRole = ''
      this.userId = -1
      this.loginAuth = false
      this.saveKey(null)
      this.coreSend('N')
      return
    }

    try {
      const resp = await fetch(`${this.authUrl}/userlogin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: fields
      })
      const body = await resp.text()

      if (!body || body[0] !== '{') {
        this.coreSend('N' + JSON.stringify({ success: false, message: 'Invalid auth response' }))
        return
      }

      const d = JSON.parse(body)
      if (d.success) {
        this.loginAuth = true
        if (d.username) this.username = d.username
        if (d.role) this.userRole = d.role
        if (d.id !== undefined) this.userId = d.id
        if (d.private_key) this.saveKey(d.private_key)
        if (d.public_key) this.publicKey = d.public_key
        this.log('Authentication successful!')
      } else {
        this.log('Authentication failed')
      }

      // Strip sensitive keys before sending to game
      const result = { ...d }
      delete result.private_key
      delete result.public_key
      this.coreSend('N' + JSON.stringify(result))
    } catch (err) {
      this.log(`ERROR: Auth error: ${err}`)
      this.coreSend('N' + JSON.stringify({ success: false, message: String(err) }))
    }
  }

  async checkLocalKey(): Promise<void> {
    if (!this.privateKey) return
    try {
      const resp = await fetch(`${this.authUrl}/userlogin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pk: this.privateKey })
      })
      const body = await resp.text()
      if (!body || body[0] !== '{') {
        this.saveKey(null)
        return
      }
      const d = JSON.parse(body)
      if (d.success) {
        this.loginAuth = true
        if (d.private_key) this.saveKey(d.private_key)
        if (d.public_key) this.publicKey = d.public_key
        if (d.username) this.username = d.username
        if (d.role) this.userRole = d.role
        if (d.id !== undefined) this.userId = d.id
        this.log('Auto-authentication successful')
      } else {
        this.saveKey(null)
      }
    } catch {
      this.saveKey(null)
    }
  }

  // ── Server Connection (C command) ──

  private async startServerSync(data: string): Promise<void> {
    const hostPort = data.substring(1)
    const colonIdx = hostPort.lastIndexOf(':')
    if (colonIdx < 0) {
      this.ulStatus = 'UlConnection Failed!'
      this.coreSend('L')
      return
    }
    const ip = hostPort.substring(0, colonIdx)
    const port = parseInt(hostPort.substring(colonIdx + 1), 10)

    await this.checkLocalKey()
    this.ulStatus = 'UlLoading...'
    this.terminate = false
    this.terminateReason = ''
    this.confList.clear()
    this.ping = -1
    this.clientId = -1
    this.serverInRelay = false
    this.connectedServerAddress = `${ip}:${port}`
    this.notifyStatusChange()

    this.log(`Connecting to server ${ip}:${port}`)
    this.startGameProxyServer()
    this.connectToServer(ip, port)
  }

  private connectToServer(ip: string, port: number): void {
    const serverSock = new net.Socket()
    this.serverSocket = serverSock
    this.serverBuffer = Buffer.alloc(0)

    serverSock.on('data', (chunk) => {
      this.serverBuffer = Buffer.concat([this.serverBuffer, chunk])
      this.processServerBuffer()
    })

    serverSock.on('error', (err) => {
      this.log(`ERROR: Server connection error: ${err.message}`)
      this.ulStatus = 'UlConnection Failed!'
      this.terminateWith(`Connection failed: ${err.message}`)
      this.coreSend('L')
      // Reject any pending server recv promises so awaits don't hang
      if (this.serverMsgResolve) {
        const r = this.serverMsgResolve
        this.serverMsgResolve = null
        r('')
      }
      if (this.serverRawResolve) {
        const r = this.serverRawResolve
        this.serverRawResolve = null
        r(Buffer.alloc(0))
      }

    })

    serverSock.on('end', () => {
      this.log('Server connection ended (remote closed)')
      this.terminateWith('Server closed the connection')
    })

    serverSock.on('close', () => {
      this.log('Server connection closed')
      const wasInRelay = this.serverInRelay
      this.connectedServerAddress = null
      this.serverInRelay = false
      this.notifyStatusChange()
      // If we were in relay (game was actively connected to server), kill the game
      // so the user doesn't get stranded at the main menu
      if (wasInRelay) {
        this.log('Connection lost while in relay — killing game')
        this.killGame()
      }
    })

    serverSock.connect(port, ip, () => {
      this.log('Connected to server!')
      serverSock.write(Buffer.from('C'))
      this.doServerHandshake(ip, port).catch((err) => {
        this.log(`ERROR: Handshake failed: ${err.message || err}`)
        this.ulStatus = 'UlConnection Failed!'
        this.terminateWith((err as Error).message || String(err))
        this.coreSend('L')
        serverSock.destroy()
      })
    })
  }

  private serverRecvMsg(timeoutMs = 30000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.terminate) { reject(new Error('Terminated')); return }
      const timer = setTimeout(() => {
        if (this.serverMsgResolve === wrappedResolve) {
          this.serverMsgResolve = null
          this.log('ERROR: serverRecvMsg timed out')
          this.terminateWith('Server response timed out')
          resolve('')
        }
      }, timeoutMs)
      const wrappedResolve = (val: string): void => {
        clearTimeout(timer)
        resolve(val)
      }
      this.serverMsgResolve = wrappedResolve
      this.processServerBuffer()
    })
  }

  private serverRecvRaw(size: number, timeoutMs?: number): Promise<Buffer> {
    // Scale timeout: at least 60s, or allow ~10 KB/s minimum throughput, whichever is larger
    const effectiveTimeout = timeoutMs ?? Math.max(60000, Math.ceil(size / 10240) * 1000 + 30000)
    return new Promise((resolve, reject) => {
      if (this.terminate) { reject(new Error('Terminated')); return }
      const timer = setTimeout(() => {
        if (this.serverRawResolve === wrappedResolve) {
          this.serverRawResolve = null
          this.log(`ERROR: serverRecvRaw timed out waiting for ${size} bytes`)
          this.terminateWith('Mod download timed out')
          resolve(Buffer.alloc(0))
        }
      }, effectiveTimeout)
      const wrappedResolve = (val: Buffer): void => {
        clearTimeout(timer)
        resolve(val)
      }
      this.serverRawResolve = wrappedResolve
      this.serverRawSize = size
      // Pre-allocate the target buffer and track write offset for streaming receives
      this.serverRawBuffer = Buffer.allocUnsafe(size)
      this.serverRawOffset = 0
      this.processServerBuffer()
    })
  }

  private processServerBuffer(): void {
    if (this.serverInRelay) {
      while (this.serverBuffer.length >= 4) {
        const len = this.serverBuffer.readUInt32LE(0)
        if (this.serverBuffer.length < 4 + len) break
        const raw = this.serverBuffer.subarray(4, 4 + len)
        this.serverBuffer = this.serverBuffer.subarray(4 + len)
        // Handle U (magic) at raw buffer level to avoid UTF-8 corruption of binary data
        if (raw.length > 0 && raw[0] === 0x55) { // 'U'
          this.magic = Buffer.from(raw.subarray(1))
          this.log(`UDP auth: received magic (${this.magic.length} bytes), sending auth`)
          for (let i = 0; i < 10; i++) this.udpSendBuf(this.magic)
          // Forward raw U message to game without UTF-8 conversion
          this.gameSendBuf(raw)
          continue
        }
        this.handleRelayMessage(this.decompressBuf(raw))
      }
      return
    }
    if (this.serverRawResolve && this.serverRawSize > 0 && this.serverRawBuffer) {
      // Stream incoming data into pre-allocated buffer instead of accumulating
      const remaining = this.serverRawSize - this.serverRawOffset
      if (this.serverBuffer.length > 0 && remaining > 0) {
        const toCopy = Math.min(this.serverBuffer.length, remaining)
        this.serverBuffer.copy(this.serverRawBuffer, this.serverRawOffset, 0, toCopy)
        this.serverRawOffset += toCopy
        this.serverBuffer = this.serverBuffer.subarray(toCopy)
        if (this.serverRawProgressCallback) {
          this.serverRawProgressCallback(this.serverRawOffset)
        }
      }
      if (this.serverRawOffset >= this.serverRawSize) {
        const data = this.serverRawBuffer
        const resolve = this.serverRawResolve
        this.serverRawResolve = null
        this.serverRawSize = 0
        this.serverRawBuffer = null
        this.serverRawOffset = 0
        this.serverRawProgressCallback = null
        resolve(data)
      }
      return
    }
    if (this.serverMsgResolve && this.serverBuffer.length >= 4) {
      const len = this.serverBuffer.readUInt32LE(0)
      if (this.serverBuffer.length >= 4 + len) {
        const raw = this.serverBuffer.subarray(4, 4 + len)
        this.serverBuffer = this.serverBuffer.subarray(4 + len)
        const resolve = this.serverMsgResolve
        this.serverMsgResolve = null
        resolve(this.decompressBuf(raw))
      }
    }
  }

  private serverSendFramed(data: string): void {
    if (this.serverSocket && !this.serverSocket.destroyed) {
      this.serverSocket.write(this.prependHeader(data))
    }
  }

  private async doServerHandshake(ip: string, port: number): Promise<void> {
    this.log(`Handshake: sending version VC${LAUNCHER_VERSION}`)
    this.serverSendFramed('VC' + LAUNCHER_VERSION)
    const vResp = await this.serverRecvMsg()
    this.log(`Handshake: version response: ${vResp?.substring(0, 50)}`)
    if (!vResp) {
      throw new Error('Server did not respond to version check (may be offline or unreachable)')
    }
    if (vResp[0] === 'E' || vResp[0] === 'K') {
      throw new Error(this.parseServerError(vResp, 'Server rejected connection'))
    }

    this.log(`Handshake: sending publicKey (${(this.publicKey || '').length} chars)`)
    this.serverSendFramed(this.publicKey || '')
    if (this.terminate) throw new Error(this.terminateReason || 'Connection lost during authentication')

    const pResp = await this.serverRecvMsg()
    if (!pResp) {
      throw new Error('Server did not respond to authentication (connection may have been dropped)')
    }
    if (pResp[0] === 'E' || pResp[0] === 'K') {
      throw new Error(this.parseServerError(pResp, 'Authentication rejected'))
    }
    if (pResp[0] !== 'P') throw new Error('Unexpected server response during auth: ' + pResp.substring(0, 80))
    const idStr = pResp.substring(1)
    if (!/^\d+$/.test(idStr)) throw new Error('Server returned invalid client ID: ' + idStr)
    this.clientId = parseInt(idStr, 10)
    this.log(`Client ID: ${this.clientId}`)

    this.serverSendFramed('SR')
    this.log('Handshake: sent SR, waiting for mod list')
    if (this.terminate) throw new Error(this.terminateReason || 'Connection lost')
    const modResp = await this.serverRecvMsg()
    if (modResp[0] === 'E' || modResp[0] === 'K') {
      throw new Error(this.parseServerError(modResp, 'Server rejected during mod sync'))
    }

    this.log(`Mod info received (${modResp.length} bytes)`)

    if (!modResp || modResp === '-') {
      this.log('No mods required')
      this.cachedModList = ''
      if (!this.preSyncActive) {
        this.coreSend('L')
      }
      this.serverSendFramed('Done')
    } else {
      await this.syncMods(modResp)
    }
    if (this.terminate) throw new Error(this.terminateReason || 'Mod sync failed')

    this.log('Handshake complete, entering relay mode')
    this.serverInRelay = true
    this.pendingRelayServer = { ip, port }

    // If the game is already connected to the proxy (early join signal flow),
    // start relay immediately instead of waiting for the proxy callback.
    if (this.gameProxySocket && !this.gameProxySocket.destroyed) {
      const { ip: rIp, port: rPort } = this.pendingRelayServer
      this.pendingRelayServer = null
      this.log('Game already on proxy — sending P, H and starting UDP')
      if (this.clientId >= 0) {
        this.gameSend('P' + this.clientId.toString())
      }
      this.serverSendFramed('H')
      this.startUdp(rIp, rPort)
    }
    this.processServerBuffer()
  }

  private async syncMods(modListJson: string): Promise<void> {
    let modInfos: ModInfo[] = []
    try { modInfos = JSON.parse(modListJson) } catch {
      this.coreSend('L')
      this.serverSendFramed('Done')
      return
    }
    if (!Array.isArray(modInfos) || modInfos.length === 0) {
      this.coreSend('L')
      this.serverSendFramed('Done')
      return
    }

    // Skip sending WMODS_FOUND to game - the game's Lua handler would crash
    // because currentServer is nil (we bypassed the in-game connect flow).
    // We auto-confirm the security warning ourselves.

    if (!existsSync(this.cachingDirectory)) mkdirSync(this.cachingDirectory, { recursive: true })

    const modNames = modInfos.map((m) => m.file_name).filter(Boolean).join(';')
    this.cachedModList = modNames
    // During pre-sync, DON'T send L yet — it would trigger the game's loading
    // state machine before connectToServer is called, causing mod map loads to
    // fail (expandMissionFileName returns false for unindexed mod levels).
    // L will be sent when the game sends C.
    if (!this.preSyncActive) {
      this.coreSend('L' + modNames)
    }

    const modsDir = join(this.gameUserDir, 'mods', 'multiplayer')
    if (!existsSync(modsDir)) mkdirSync(modsDir, { recursive: true })

    // Clean up stale mods from previous sessions that aren't needed by this server.
    // The game's MPModManager iterates ALL zips in mods/multiplayer and calls
    // isModAllowed(modName) for each — if a leftover zip has no valid info.json
    // (nil modName), the Lua crashes with "bad argument #1 to 'lower'".
    const requiredFiles = new Set(modInfos.map((m) => m.file_name.toLowerCase()))
    try {
      for (const file of readdirSync(modsDir)) {
        if (!file.toLowerCase().endsWith('.zip')) continue
        // Never remove BeamMP.zip — it's the core multiplayer mod
        if (file.toLowerCase() === 'beammp.zip') continue
        if (!requiredFiles.has(file.toLowerCase())) {
          try {
            unlinkSync(join(modsDir, file))
            this.log(`Removed stale mod: ${file}`)
          } catch { /* ignore removal errors */ }
        }
      }
    } catch { /* ignore if directory read fails */ }

    this.log(`Syncing ${modInfos.length} mods...`)

    for (let i = 0; i < modInfos.length && !this.terminate; i++) {
      const mod = modInfos[i]
      if (mod.hash_algorithm !== 'sha256' || mod.hash.length < 8) {
        this.log(`ERROR: Bad hash for ${mod.file_name}`)
        this.terminateWith(`Mod "${mod.file_name}" has an invalid hash — server may be misconfigured`)
        return
      }

      const stem = basename(mod.file_name, extname(mod.file_name))
      const ext = extname(mod.file_name)
      const cachedName = `${stem}-${mod.hash.substring(0, 8)}${ext}`
      const cachedPath = join(this.cachingDirectory, cachedName)
      const destPath = join(modsDir, mod.file_name)

      let needDownload = true
      if (existsSync(cachedPath)) {
        try {
          if (await this.hashFile(cachedPath) === mod.hash) needDownload = false
        } catch { /* redownload */ }
      }

      if (needDownload) {
        if (mod.protected) { this.terminateWith(`Mod "${mod.file_name}" is protected and cannot be downloaded`); return }
        this.ulStatus = `UlDownloading Resource ${i + 1}/${modInfos.length}: ${mod.file_name}`
        this.emitModSyncProgress({ phase: 'downloading', modIndex: i, modCount: modInfos.length, fileName: mod.file_name, received: 0, total: mod.file_size })
        this.log(`Downloading ${mod.file_name} (${mod.file_size} bytes)`)
        this.serverSendFramed('f' + mod.file_name)
        const dlResp = await this.serverRecvMsg()
        if (dlResp === 'CO' || this.terminate) { this.terminateWith(`Server refused to send mod "${mod.file_name}"`); return }
        if (dlResp !== 'AG') { this.terminateWith(`Unexpected response downloading mod "${mod.file_name}": ${dlResp?.substring(0, 40)}`); return }
        // Stream progress updates to the overlay as data arrives
        this.serverRawProgressCallback = (received: number): void => {
          this.emitModSyncProgress({ phase: 'downloading', modIndex: i, modCount: modInfos.length, fileName: mod.file_name, received, total: mod.file_size })
        }
        const fileData = await this.serverRecvRaw(mod.file_size)
        if (this.terminate || fileData.length !== mod.file_size) { this.terminateWith(`Download of "${mod.file_name}" was incomplete (got ${fileData.length} of ${mod.file_size} bytes)`); return }
        this.emitModSyncProgress({ phase: 'downloading', modIndex: i, modCount: modInfos.length, fileName: mod.file_name, received: mod.file_size, total: mod.file_size })
        writeFileSync(cachedPath, fileData)
        const hash = await this.hashFile(cachedPath)
        if (hash !== mod.hash) {
          try { unlinkSync(cachedPath) } catch { /* */ }
          this.terminateWith(`Hash mismatch for "${mod.file_name}" — downloaded file is corrupted`)
          return
        }
        this.log(`Downloaded ${mod.file_name}`)
      }

      this.ulStatus = `UlLoading Resource ${i + 1}/${modInfos.length}: ${mod.file_name}`
      this.emitModSyncProgress({ phase: 'loading', modIndex: i, modCount: modInfos.length, fileName: mod.file_name, received: 0, total: mod.file_size })
      try {
        const tmpPath = destPath + '.tmp'
        copyFileSync(cachedPath, tmpPath)
        renameSync(tmpPath, destPath)
      } catch (err) {
        this.log(`ERROR: Failed to copy mod: ${err}`)
        this.terminateWith(`Failed to install mod "${mod.file_name}": ${err}`)
        return
      }
      this.log(`Mod ${mod.file_name} placed (${i + 1}/${modInfos.length})`)
    }

    if (!this.terminate) {
      this.serverSendFramed('Done')
      this.log('Mod sync complete!')
    } else {
      this.log('Mod sync aborted due to error or timeout')
    }
    // Always emit done so the overlay dismisses itself
    this.emitModSyncProgress({ phase: 'done', modIndex: modInfos.length, modCount: modInfos.length, fileName: '', received: 0, total: 0 })
  }

  private handleRelayMessage(data: string): void {
    if (!data.length) return
    const code = data[0]

    // Log relay messages from server (skip p ping and high-frequency E/O/V/W traffic)
    if (code !== 'p' && code !== 'E' && code !== 'O' && code !== 'V' && code !== 'W') {
      this.log(`Relay ← Server: ${code} (${data.length} bytes)${data.length < 120 ? ' → ' + data.substring(0, 120) : ''}`)
    }

    switch (code) {
      case 'p':
        if (this.pingStart > 0) this.ping = Date.now() - this.pingStart
        return
      case 'M':
        this.mStatus = data
        // During pre-sync, don't set Uldone yet — it will be staged when the
        // game sends C. Otherwise the game's state machine runs too early.
        if (!this.preSyncActive) {
          this.ulStatus = 'Uldone'
        }
        this.log(`Map received from server, cached map: ${data.substring(0, 80)}`)
        // Official launcher caches M and does NOT forward it to game.
        // The game requests map data via core socket 'M' message instead.
        return
      case 'U':
        // U (magic) is handled at raw buffer level in processServerBuffer
        // to avoid UTF-8 corruption. This case only triggers for non-binary U messages.
        break
      case 'E':
        // During relay, 'E' is the prefix for TriggerClientEvent — server-side Lua mods
        // sending event messages to the client (e.g. E:rxFuelTechHandshake:...,
        // E:rxInputUpdate:...).  These must be forwarded to the game, NOT treated as
        // errors.  Only 'K' (kick) is a real disconnect during relay.
        break
      case 'K': {
        const reason = this.parseServerError(data, 'Disconnected by server')
        this.ulStatus = 'UlDisconnected: ' + data.substring(1)
        this.log(`Server sent ${code} — killing game: ${reason}`)
        this.terminateWith(reason)
        this.netReset()
        this.killGame()
        return // don't forward to game — it's being killed
      }
    }
    this.gameSend(data)
  }

  private gameSend(data: string): void {
    if (this.gameProxySocket && !this.gameProxySocket.destroyed) {
      this.gameProxySocket.write(this.prependHeader(data))
    }
  }

  private gameSendBuf(data: Buffer): void {
    if (this.gameProxySocket && !this.gameProxySocket.destroyed) {
      const header = Buffer.alloc(4)
      header.writeUInt32LE(data.length, 0)
      this.gameProxySocket.write(Buffer.concat([header, data]))
    }
  }

  /**
   * Route a game→server message with the same logic as the official launcher's
   * ServerSend (GlobalHandler.cpp).
   *
   * Routing rules (matching official C++ exactly):
   *   • Code extracted only when len > 3 (otherwise C = 0 → goes UDP)
   *   • O, T → "Ack" → TCP, compressed (SendLarge) if > 400 bytes
   *   • N, W, Y, V, E, C → "Rel" (reliable) → TCP (plain if ≤ 1000, compressed if > 1000)
   *   • compressBound > 1024 (~≈ len > 1024) → forced reliable
   *   • Everything else → UDP (compressed if > 400 bytes)
   */
  private serverSend(data: string): void {
    if (!this.serverSocket || this.serverSocket.destroyed || this.terminate) return
    if (!data.length) return

    const len = data.length
    const code = len > 3 ? data[0] : '\0'
    const isAck = code === 'O' || code === 'T'
    let isRel = 'NWYVEC'.includes(code) && code !== '\0'
    if (len > 1024) isRel = true                   // compressBound heuristic

    if (isAck || isRel) {
      if (isAck || len > 1000) {
        this.serverSendLarge(data)                   // TCP + compression
      } else {
        this.serverSendFramed(data)                  // TCP, no compression
      }
    } else {
      this.udpSend(data)                             // UDP (compresses if > 400)
    }
  }

  /** TCP send with ABG: compression for payloads > 400 bytes (matches SendLarge) */
  private serverSendLarge(data: string): void {
    if (!this.serverSocket || this.serverSocket.destroyed) return
    const buf = Buffer.from(data, 'utf-8')
    if (buf.length > 400) {
      const compressed = zlib.deflateSync(buf)
      const payload = Buffer.concat([Buffer.from('ABG:'), compressed])
      const header = Buffer.alloc(4)
      header.writeUInt32LE(payload.length, 0)
      this.serverSocket.write(Buffer.concat([header, payload]))
    } else {
      this.serverSendFramed(data)
    }
  }

  private startUdp(ip: string, port: number): void {
    this.udpTarget = { ip, port }
    this.udpSocket = dgram.createSocket('udp4')
    this.udpSocket.on('message', (msg) => {
      const str = msg.toString('utf-8')
      if (str === 'p') {
        // UDP ping response — update ping measurement
        if (this.pingStart > 0) this.ping = Date.now() - this.pingStart
        return
      }
      if (str.startsWith('ABG:')) {
        try { this.gameSend(zlib.inflateSync(msg.subarray(4)).toString('utf-8')) } catch { /**/ }
      } else {
        this.gameSend(str)
      }
    })
    this.udpSocket.on('error', (err) => this.log(`ERROR: UDP error: ${err.message}`))

    // If magic was already received via TCP relay before UDP was ready,
    // authenticate now (official launcher does this in UDPClientMain).
    if (this.magic) {
      this.log(`UDP socket ready, sending stored magic auth (${this.magic.length} bytes)`)
      for (let i = 0; i < 10; i++) this.udpSendBuf(this.magic)
    }

    // Send initial ping immediately (matches official launcher)
    this.udpSend('p')
    this.pingStart = Date.now()

    this.pingInterval = setInterval(() => {
      if (this.terminate) { if (this.pingInterval) clearInterval(this.pingInterval); return }
      this.pingStart = Date.now()
      this.udpSend('p')
    }, 1000)
  }

  private udpSend(data: string): void {
    if (!this.udpSocket || !this.udpTarget || this.clientId < 0) return
    // Compress payloads > 400 bytes with ABG: prefix (matches official UDPSend)
    let payload: string | Buffer = data
    if (data.length > 400) {
      const compressed = zlib.deflateSync(Buffer.from(data, 'utf-8'))
      payload = Buffer.concat([Buffer.from('ABG:'), compressed])
    }
    const prefix = Buffer.from(String.fromCharCode(this.clientId + 1) + ':')
    const body = typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload
    this.udpSocket.send(Buffer.concat([prefix, body]), this.udpTarget.port, this.udpTarget.ip)
  }

  private udpSendBuf(data: Buffer): void {
    if (!this.udpSocket || !this.udpTarget || this.clientId < 0) return
    const prefix = Buffer.from([this.clientId + 1, 0x3A]) // <id+1>:
    this.udpSocket.send(Buffer.concat([prefix, data]), this.udpTarget.port, this.udpTarget.ip)
  }

  private startGameProxyServer(): void {
    if (this.gameProxyServer) { this.gameProxyServer.close(); this.gameProxyServer = null }
    const proxyPort = this.corePort + 1
    this.gameProxyServer = net.createServer((socket) => {
      this.log('(Proxy) Game Connected!')
      this.gameProxySocket = socket

      // Only initiate relay handshake (P + H + UDP) if we're already in relay mode.
      // If the game connects DURING mod sync (early join signal), just store the
      // socket — doServerHandshake will detect it later and start relay then.
      if (this.serverInRelay && this.pendingRelayServer) {
        const { ip, port } = this.pendingRelayServer
        this.pendingRelayServer = null
        if (this.clientId >= 0) {
          this.log(`Sending P${this.clientId} to game via proxy`)
          this.gameSend('P' + this.clientId.toString())
        }
        this.log('Sending H to server (relay start) and starting UDP')
        this.serverSendFramed('H')
        this.startUdp(ip, port)
        this.processServerBuffer()
      } else if (this.serverInRelay && this.clientId >= 0) {
        // Relay already active (H already sent) — just send P
        this.log(`Sending P${this.clientId} to game via proxy (relay already active)`)
        this.gameSend('P' + this.clientId.toString())
      } else {
        this.log('Game connected to proxy before relay — deferring P/H until relay starts')
      }

      let buf = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 4) {
          const len = buf.readUInt32LE(0)
          if (buf.length < 4 + len) break
          const msg = buf.subarray(4, 4 + len).toString('utf-8')
          buf = buf.subarray(4 + len)
          // CRITICAL: Only forward game data to server when in relay mode.
          // During mod sync, game data would corrupt the server protocol.
          if (this.serverInRelay) {
            this.serverSend(msg)
          }
        }
      })
      socket.on('close', () => { this.gameProxySocket = null })
      socket.on('error', (err) => { this.log(`ERROR: Proxy error: ${err.message}`); this.gameProxySocket = null })
    })
    this.gameProxyServer.listen(proxyPort, '127.0.0.1', () => this.log(`Game proxy listening on port ${proxyPort}`))
    this.gameProxyServer.on('error', (err) => this.log(`ERROR: Game proxy server error: ${err}`))
  }


  // ── HTTP Proxy ──

  private startHttpProxy(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.httpProxy) {
        resolve()
        return
      }

      this.httpProxy = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
        this.handleHttpProxyRequest(req, res)
      })

      this.httpProxy.on('error', (err) => {
        this.log(`ERROR: HTTP proxy error: ${err}`)
        reject(err)
      })

      // Bind to any available port
      this.httpProxy.listen(0, '127.0.0.1', () => {
        const addr = this.httpProxy!.address()
        this.httpProxyPort = typeof addr === 'object' && addr ? addr.port : 0
        this.log(`HTTP Proxy listening on port ${this.httpProxyPort}`)
        resolve()
      })
    })
  }

  private handleHttpProxyRequest(req: IncomingMessage, res: ServerResponse): void {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Request-Method', 'POST, OPTIONS, GET')
    res.setHeader('Access-Control-Request-Headers', 'X-API-Version')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    const path = req.url || '/'
    const parts = path.split('/').filter(Boolean)
    const host = parts[0] || ''

    if (host === 'backend') {
      const remainingPath = path.substring('/backend'.length)
      this.proxyToBackend(req, res, remainingPath)
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Host not found')
    }
  }

  private proxyToBackend(req: IncomingMessage, res: ServerResponse, path: string): void {
    const url = `${this.backendUrl}${path}`
    const headers: Record<string, string> = {
      'User-Agent': `BeamMP-Launcher/${LAUNCHER_VERSION}`
    }

    // Forward auth header
    if (req.headers['x-bmp-authentication'] && this.privateKey) {
      headers['X-BMP-Authentication'] = this.privateKey
    }
    if (req.headers['x-api-version']) {
      headers['X-API-Version'] = req.headers['x-api-version'] as string
    }

    const isPost = req.method === 'POST'
    const bodyChunks: Buffer[] = []

    const doRequest = (): void => {
      const proxyReq = httpsRequest(
        url,
        {
          method: req.method,
          headers,
          timeout: 30000
        },
        (proxyRes) => {
          const responseChunks: Buffer[] = []
          proxyRes.on('data', (chunk) => responseChunks.push(chunk))
          proxyRes.on('end', () => {
            const body = Buffer.concat(responseChunks)
            const contentType = proxyRes.headers['content-type'] || 'application/octet-stream'
            res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': contentType })
            res.end(body)
          })
        }
      )

      proxyReq.on('error', (err) => {
        this.log(`ERROR: HTTP proxy upstream error: ${err.message}`)
        res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('Proxy error: ' + err.message)
      })

      if (isPost && bodyChunks.length > 0) {
        proxyReq.write(Buffer.concat(bodyChunks))
      }
      proxyReq.end()
    }

    if (isPost) {
      req.on('data', (chunk) => bodyChunks.push(chunk))
      req.on('end', doRequest)
    } else {
      doRequest()
    }
  }

  // ── State management ──

  private localReset(): void {
    this.mStatus = ' '
    this.ulStatus = 'Ulstart'
    this.confList.clear()
    this.gameInitialized = false
  }

  private netReset(): void {
    this.serverInRelay = false
    this.clientId = -1
    this.pendingRelayServer = null
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null }
    if (this.udpSocket) { try { this.udpSocket.close() } catch { /* */ } this.udpSocket = null }
    this.udpTarget = null
    this.serverMsgResolve = null
    this.serverRawResolve = null
    this.terminate = false
    this.ulStatus = 'Ulstart'
    this.cachedModList = ''
    this.preSyncActive = false
    this.mStatus = ' '
    this.connectedServerAddress = null

    if (this.serverSocket) {
      this.serverSocket.destroy()
      this.serverSocket = null
    }
    if (this.gameProxySocket) {
      this.gameProxySocket.destroy()
      this.gameProxySocket = null
    }
    if (this.gameProxyServer) {
      this.gameProxyServer.close()
      this.gameProxyServer = null
    }
  }

  // ── Public API ──

  async launchGame(
    paths: GamePaths,
    options?: { args?: string[] }
  ): Promise<{ success: boolean; error?: string }> {
    if (this.gameProcess && !this.gameProcess.killed) {
      return { success: false, error: 'Game is already running' }
    }

    if (!paths.executable || !existsSync(paths.executable)) {
      return { success: false, error: 'BeamNG.drive executable not found' }
    }

    if (!paths.userDir) {
      return { success: false, error: 'User data folder not found' }
    }

    this.gameUserDir = paths.userDir

    // Clean up old bridge artifacts and stale signal files
    this.cleanupBridgeArtifacts()

    // Patch BeamMP.zip in-place to inject bridge extension
    const beammpZipPath = join(paths.userDir, 'mods', 'multiplayer', 'BeamMP.zip')
    if (existsSync(beammpZipPath)) {
      try {
        const sourceZip = readFileSync(beammpZipPath)
        const patchedZip = this.patchBeamMPZip(sourceZip)
        if (patchedZip.length !== sourceZip.length || !patchedZip.equals(sourceZip)) {
          writeFileSync(beammpZipPath, patchedZip)
        }
      } catch (err) {
        this.log(`WARNING: Failed to patch BeamMP.zip: ${err}`)
      }
    } else {
      this.log('WARNING: BeamMP.zip not found at ' + beammpZipPath)
    }

    // Start HTTP proxy (random port)
    try {
      await this.startHttpProxy()
    } catch (err) {
      return { success: false, error: `Failed to start HTTP proxy: ${err}` }
    }

    // Start Core TCP server (port 4444)
    try {
      await this.startCoreServer()
    } catch (err) {
      return { success: false, error: `Failed to start Core Network: ${err}` }
    }

    // Auto-authenticate with saved key
    await this.checkLocalKey()

    // Launch the game
    const args = options?.args ?? []
    try {
      if (paths.isProton) {
        // Proton: launch through Steam with the BeamNG app ID
        const steamBin = this.findSteamBinary()
        if (!steamBin) {
          return { success: false, error: 'Steam not found — required to launch BeamNG.drive via Proton' }
        }
        const steamArgs = ['-applaunch', '284160', ...args]
        this.log(`Launching via Steam/Proton: ${steamBin} ${steamArgs.join(' ')}`)
        this.gameProcess = spawn(steamBin, steamArgs, {
          detached: false,
          stdio: 'ignore'
        })
      } else {
        this.gameProcess = spawn(paths.executable, args, {
          cwd: paths.installDir ?? undefined,
          detached: false,
          stdio: 'ignore'
        })
      }

      this.gameProcess.on('exit', (code) => {
        this.log(`BeamNG.drive exited with code ${code}`)
        this.gameProcess = null
        this.shutdown()
        this.notifyStatusChange()
      })

      this.gameProcess.on('error', (err) => {
        this.log(`ERROR: Failed to launch BeamNG.drive: ${err}`)
        this.gameProcess = null
        this.shutdown()
        this.notifyStatusChange()
      })

      this.log('Game Launched!')
      this.notifyStatusChange()
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to launch game: ${err}` }
    }
  }

  // ── Singleplayer bridge deployment ──

  private deployVanillaBridge(userDir: string): void {
    // Deploy to <userDir>/lua/ge/extensions/ — BeamNG auto-discovers extensions here
    const bridgeDir = join(userDir, 'lua', 'ge', 'extensions')
    mkdirSync(bridgeDir, { recursive: true })
    writeFileSync(join(bridgeDir, 'beamcmBridge.lua'), VANILLA_BRIDGE_LUA.trim())
    this.log('Vanilla bridge deployed to ' + join(bridgeDir, 'beamcmBridge.lua'))
  }

  private writeVanillaSignal(userDir: string, config: { mode: string; level?: string; vehicle?: string }): void {
    const signalDir = join(userDir, 'settings', 'BeamCM')
    mkdirSync(signalDir, { recursive: true })
    writeFileSync(join(signalDir, 'launch_signal.json'), JSON.stringify({
      mode: config.mode,
      level: config.level || null,
      vehicle: config.vehicle || null,
      processed: false
    }))
    this.log('Vanilla signal: ' + JSON.stringify(config))
  }

  /**
   * Launch BeamNG.drive in vanilla (single-player) mode — no BeamMP proxy/bridge.
   * Deploys a lightweight Lua bridge mod that can auto-load a level and spawn a vehicle.
   */
  async launchVanilla(
    paths: GamePaths,
    config?: { mode?: string; level?: string; vehicle?: string },
    options?: { args?: string[] }
  ): Promise<{ success: boolean; error?: string }> {
    if (this.gameProcess && !this.gameProcess.killed) {
      return { success: false, error: 'Game is already running' }
    }
    if (!paths.executable || !existsSync(paths.executable)) {
      return { success: false, error: 'BeamNG.drive executable not found' }
    }
    if (!paths.userDir) {
      return { success: false, error: 'User data folder not found' }
    }

    // Deploy the singleplayer bridge mod
    try {
      this.deployVanillaBridge(paths.userDir)
    } catch (err) {
      this.log(`WARNING: Failed to deploy vanilla bridge: ${err}`)
    }

    // Write launch signal so the bridge knows what to load
    if (config?.mode) {
      this.writeVanillaSignal(paths.userDir, {
        mode: config.mode,
        level: config.level ? `${config.level}/info.json` : undefined,
        vehicle: config.vehicle
      })
    }

    // Build command-line args — use -level for direct level loading
    const args: string[] = [...(options?.args ?? [])]
    if (config?.mode === 'freeroam' && config.level) {
      // BeamNG prepends "levels/" internally, so just pass the folder name
      args.push('-level', `${config.level}/info.json`)
    }

    try {
      if (paths.isProton) {
        const steamBin = this.findSteamBinary()
        if (!steamBin) {
          return { success: false, error: 'Steam not found — required to launch BeamNG.drive via Proton' }
        }
        const steamArgs = ['-applaunch', '284160', ...args]
        this.log(`Launching vanilla via Steam/Proton: ${steamBin} ${steamArgs.join(' ')}`)
        this.gameProcess = spawn(steamBin, steamArgs, {
          detached: false,
          stdio: 'ignore'
        })
      } else {
        this.gameProcess = spawn(paths.executable, args, {
          cwd: paths.installDir ?? undefined,
          detached: false,
          stdio: 'ignore'
        })
      }

      this.gameProcess.on('exit', (code) => {
        this.log(`BeamNG.drive (vanilla) exited with code ${code}`)
        this.gameProcess = null
        this.notifyStatusChange()
      })

      this.gameProcess.on('error', (err) => {
        this.log(`ERROR: Failed to launch BeamNG.drive (vanilla): ${err}`)
        this.gameProcess = null
        this.notifyStatusChange()
      })

      this.log(`Game Launched (vanilla) args=[${args.join(' ')}]`)
      this.notifyStatusChange()
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to launch game: ${err}` }
    }
  }

  /** Locate the Steam binary on Linux/Mac for Proton launches */
  private findSteamBinary(): string | null {
    // Try `which steam` first
    try {
      const result = execSync('which steam', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
      const steamPath = result.trim()
      if (steamPath && existsSync(steamPath)) return steamPath
    } catch { /* not in PATH */ }

    // Common locations on Linux
    const candidates = [
      '/usr/bin/steam',
      '/usr/local/bin/steam',
      '/usr/games/steam',
      join(homedir(), '.local', 'share', 'Steam', 'ubuntu12_32', 'steam'),
      // Flatpak
      '/var/lib/flatpak/exports/bin/com.valvesoftware.Steam',
      // Snap
      '/snap/bin/steam'
    ]

    for (const p of candidates) {
      if (existsSync(p)) return p
    }

    return null
  }

  killGame(): void {
    if (this.gameProcess && !this.gameProcess.killed) {
      this.gameProcess.kill()
      this.gameProcess = null
      this.shutdown()
      this.notifyStatusChange()
    }
  }

  joinServer(ip: string, port: number, paths: GamePaths, options?: { args?: string[] }): Promise<{ success: boolean; error?: string }> {
    return this.joinServerImpl(ip, port, paths, options)
  }

  private async joinServerImpl(ip: string, port: number, paths: GamePaths, options?: { args?: string[] }): Promise<{ success: boolean; error?: string }> {
    // Auto-login as guest if not authenticated
    if (!this.loginAuth) {
      await this.loginAsGuest()
    }

    // Disconnect from current server if needed
    if (this.serverSocket && !this.serverSocket.destroyed) {
      this.netReset()
      this.terminate = true
    }

    // Launch game if not running
    if (!this.gameProcess || this.gameProcess.killed) {
      this.gameInitialized = false
      const result = await this.launchGame(paths, options)
      if (!result.success) {
        return result
      }
    }

    // Wait for game mod to be ready (Nc auth handshake) if not already
    if (!this.gameInitialized || !this.coreSocket || this.coreSocket.destroyed) {
      try {
        await this.waitForGameReady()
      } catch {
        return { success: false, error: 'Game did not initialize in time' }
      }
    }

    // Set up server connection state
    this.log(`Pre-syncing server ${ip}:${port} before game connect`)
    this.preSyncActive = true
    await this.checkLocalKey()
    this.ulStatus = 'UlLoading...'
    this.terminate = false
    this.terminateReason = ''
    this.confList.clear()
    this.ping = -1
    this.clientId = -1
    this.serverInRelay = false
    this.connectedServerAddress = `${ip}:${port}`
    this.notifyStatusChange()
    this.startGameProxyServer()

    // Connect to server — do the handshake + mod sync BEFORE telling
    // the game to connect.  This way, if the server rejects us (full,
    // banned, version mismatch, etc.) we never send the join signal
    // and can kill the game cleanly instead of it landing on the menu.
    this.connectToServer(ip, port)

    // Wait for handshake + mod sync to complete (relay mode entered)
    try {
      await new Promise<void>((resolve, reject) => {
        const check = setInterval(() => {
          if (this.serverInRelay) { clearInterval(check); resolve() }
          else if (this.terminate) { clearInterval(check); reject(new Error(this.terminateReason || 'Server sync failed')) }
        }, 100)
        setTimeout(() => { clearInterval(check); reject(new Error('Server connection timed out after 30 minutes')) }, 1800000)
      })
    } catch (err) {
      const errorMsg = (err as Error).message
      this.log(`Server join failed, killing game: ${errorMsg}`)
      this.preSyncActive = false
      this.killGame()
      return { success: false, error: errorMsg }
    }

    // Handshake succeeded — NOW tell the game to connect
    this.writeJoinSignal(ip, port)
    this.log('Server sync complete and relay active — join signal sent to game')
    return { success: true }
  }

  private writeJoinSignal(ip: string, port: number): void {
    const signalDir = join(this.gameUserDir, 'settings', 'BeamMP')
    if (!existsSync(signalDir)) mkdirSync(signalDir, { recursive: true })
    const signalPath = join(signalDir, 'cm_join.json')
    writeFileSync(signalPath, JSON.stringify({ ip, port }))
    this.log(`Join signal written: ${signalPath}`)
  }

  private cleanupBridgeArtifacts(): void {
    // Clean up old files from previous approaches
    const oldLoose = join(this.gameUserDir, 'lua', 'ge', 'extensions', 'beammpCMBridge.lua')
    if (existsSync(oldLoose)) {
      try { unlinkSync(oldLoose) } catch { /* ignore */ }
    }
    const oldZipRoot = join(this.gameUserDir, 'mods', 'beammpCMBridge.zip')
    if (existsSync(oldZipRoot)) {
      try { unlinkSync(oldZipRoot) } catch { /* ignore */ }
    }
    const oldZipRepo = join(this.gameUserDir, 'mods', 'repo', 'beammpCMBridge.zip')
    if (existsSync(oldZipRepo)) {
      try { unlinkSync(oldZipRepo) } catch { /* ignore */ }
    }
    const oldZipMp = join(this.gameUserDir, 'mods', 'multiplayer', 'beammpCMBridge.zip')
    if (existsSync(oldZipMp)) {
      try { unlinkSync(oldZipMp) } catch { /* ignore */ }
    }

    // Clean up stale signal file from previous run
    const staleSignal = join(this.gameUserDir, 'settings', 'BeamMP', 'cm_join.json')
    if (existsSync(staleSignal)) {
      try { unlinkSync(staleSignal) } catch { /* ignore */ }
    }
  }

  private patchBeamMPZip(source: Buffer): Buffer {
    // Find EOCD (End of Central Directory)
    let eocdOff = -1
    for (let i = source.length - 22; i >= Math.max(0, source.length - 65557); i--) {
      if (source.readUInt32LE(i) === 0x06054b50) { eocdOff = i; break }
    }
    if (eocdOff < 0) throw new Error('Invalid ZIP: EOCD not found')

    const numEntries = source.readUInt16LE(eocdOff + 10)
    const cdOffset = source.readUInt32LE(eocdOff + 16)

    // Parse central directory entries
    const entries: Array<{
      cdPos: number; cdLen: number; localOff: number; name: string
      compression: number; compSize: number; uncompSize: number; fileCrc: number
    }> = []
    let pos = cdOffset
    for (let i = 0; i < numEntries; i++) {
      if (source.readUInt32LE(pos) !== 0x02014b50) throw new Error('Invalid CD entry')
      const nameLen = source.readUInt16LE(pos + 28)
      const extraLen = source.readUInt16LE(pos + 30)
      const commentLen = source.readUInt16LE(pos + 32)
      const cdLen = 46 + nameLen + extraLen + commentLen
      entries.push({
        cdPos: pos, cdLen,
        localOff: source.readUInt32LE(pos + 42),
        name: source.subarray(pos + 46, pos + 46 + nameLen).toString('utf-8'),
        compression: source.readUInt16LE(pos + 10),
        compSize: source.readUInt32LE(pos + 20),
        uncompSize: source.readUInt32LE(pos + 24),
        fileCrc: source.readUInt32LE(pos + 16)
      })
      pos += cdLen
    }

    // Check if bridge already present and current
    let bridgeAlreadyCurrent = false
    const bridgeEntry = entries.find(e => e.name === 'lua/ge/extensions/beammpCMBridge.lua')
    if (bridgeEntry) {
      const bridgeBuf = Buffer.from(BRIDGE_LUA, 'utf-8')
      const expectedCrc = crc32(bridgeBuf)
      if (bridgeEntry.fileCrc === expectedCrc) {
        bridgeAlreadyCurrent = true
      } else {
        this.log('BeamMP.zip contains outdated bridge, re-patching')
        // Remove old bridge entry so it gets replaced
        const idx = entries.indexOf(bridgeEntry)
        entries.splice(idx, 1)
      }
    }

    // Check if MPModManager.lua already has nil guard
    const modManagerEntry = entries.find(e => e.name === 'lua/ge/extensions/MPModManager.lua')
    let modManagerAlreadyPatched = false
    if (modManagerEntry) {
      const mmLocalNameLen = source.readUInt16LE(modManagerEntry.localOff + 26)
      const mmLocalExtraLen = source.readUInt16LE(modManagerEntry.localOff + 28)
      const mmStart = modManagerEntry.localOff + 30 + mmLocalNameLen + mmLocalExtraLen
      const mmComp = source.subarray(mmStart, mmStart + modManagerEntry.compSize)
      let mmRaw: Buffer
      if (modManagerEntry.compression === 8) {
        mmRaw = zlib.inflateRawSync(mmComp)
      } else {
        mmRaw = Buffer.from(mmComp)
      }
      modManagerAlreadyPatched = mmRaw.toString('utf-8').includes('if not modName then return false end')
    }

    // Skip rebuild entirely if everything is already patched
    if (bridgeAlreadyCurrent && modManagerAlreadyPatched) {
      this.log('BeamMP.zip already fully patched, skipping')
      return source
    }

    // Build output local file entries
    const locals: Buffer[] = []
    const offsets: number[] = []
    const modScriptIdx = entries.findIndex(e => e.name === 'scripts/BeamMP/modScript.lua')
    let outOff = 0

    // Track modified entries for CD rebuild
    const modified = new Map<number, { content: Buffer; newCrc: number }>()

    // Patch modScript.lua to load our bridge extension
    if (modScriptIdx >= 0) {
      const ms = entries[modScriptIdx]
      const localNameLen = source.readUInt16LE(ms.localOff + 26)
      const localExtraLen = source.readUInt16LE(ms.localOff + 28)
      const dataStart = ms.localOff + 30 + localNameLen + localExtraLen
      const compData = source.subarray(dataStart, dataStart + ms.compSize)

      let content: Buffer
      if (ms.compression === 8) {
        content = zlib.inflateRawSync(compData)
      } else {
        content = Buffer.from(compData)
      }

      const patch = '\nload("beammpCMBridge")\nsetExtensionUnloadMode("beammpCMBridge", "manual")\n'
      // Only append the patch if modScript doesn't already load the bridge
      if (!content.toString('utf-8').includes('load("beammpCMBridge")')) {
        const patched = Buffer.concat([content, Buffer.from(patch, 'utf-8')])
        modified.set(modScriptIdx, { content: patched, newCrc: crc32(patched) })
      }
    }

    // Patch MPModManager.lua to add nil guards (prevents crash when mods in db.json lack modname)
    const modManagerIdx = entries.findIndex(e => e.name === 'lua/ge/extensions/MPModManager.lua')
    if (modManagerIdx >= 0) {
      const mm = entries[modManagerIdx]
      const mmNameLen = source.readUInt16LE(mm.localOff + 26)
      const mmExtraLen = source.readUInt16LE(mm.localOff + 28)
      const mmDataStart = mm.localOff + 30 + mmNameLen + mmExtraLen
      const mmCompData = source.subarray(mmDataStart, mmDataStart + mm.compSize)

      let mmContent: Buffer
      if (mm.compression === 8) {
        mmContent = zlib.inflateRawSync(mmCompData)
      } else {
        mmContent = Buffer.from(mmCompData)
      }

      let luaStr = mmContent.toString('utf-8')
      let mmPatched = false

      // Guard isModAllowed against nil modName
      const isModAllowedSig = 'local function isModAllowed(modName)\n\tfor'
      if (luaStr.includes(isModAllowedSig) && !luaStr.includes('if not modName then return false end')) {
        luaStr = luaStr.replace(
          isModAllowedSig,
          'local function isModAllowed(modName)\n\tif not modName then return false end\n\tfor'
        )
        mmPatched = true
      }

      // Guard isModWhitelisted against nil modName
      const isWhitelistedSig = 'local function isModWhitelisted(modName)\n\tfor'
      if (luaStr.includes(isWhitelistedSig) && !luaStr.includes('if not modName then return true end')) {
        luaStr = luaStr.replace(
          isWhitelistedSig,
          'local function isModWhitelisted(modName)\n\tif not modName then return true end\n\tfor'
        )
        mmPatched = true
      }

      // Guard checkMod against nil mod.modname
      const checkModSig = 'local function checkMod(mod)'
      if (luaStr.includes(checkModSig) && !luaStr.includes('if not mod.modname then return end')) {
        luaStr = luaStr.replace(
          checkModSig,
          'local function checkMod(mod)\n\tif not mod.modname then return end'
        )
        mmPatched = true
      }

      if (mmPatched) {
        const patchedBuf = Buffer.from(luaStr, 'utf-8')
        modified.set(modManagerIdx, { content: patchedBuf, newCrc: crc32(patchedBuf) })
        this.log('Patched MPModManager.lua with nil modName guards')
      }
    }

    // Write local file entries
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      offsets.push(outOff)

      const mod = modified.get(i)
      if (mod) {
        // Rebuilt entry using STORE compression
        const nameBytes = Buffer.from(e.name, 'utf-8')
        const hdr = Buffer.alloc(30 + nameBytes.length)
        hdr.writeUInt32LE(0x04034b50, 0)
        hdr.writeUInt16LE(20, 4)
        hdr.writeUInt16LE(0, 8)  // STORE
        hdr.writeUInt32LE(mod.newCrc, 14)
        hdr.writeUInt32LE(mod.content.length, 18)
        hdr.writeUInt32LE(mod.content.length, 22)
        hdr.writeUInt16LE(nameBytes.length, 26)
        nameBytes.copy(hdr, 30)
        locals.push(Buffer.concat([hdr, mod.content]))
        outOff += hdr.length + mod.content.length
      } else {
        // Copy original local file header + data as-is
        const localNameLen = source.readUInt16LE(e.localOff + 26)
        const localExtraLen = source.readUInt16LE(e.localOff + 28)
        const totalSize = 30 + localNameLen + localExtraLen + e.compSize
        locals.push(Buffer.from(source.subarray(e.localOff, e.localOff + totalSize)))
        outOff += totalSize
      }
    }

    // Append bridge extension file (only if not already present and current)
    const bridgeContent = Buffer.from(BRIDGE_LUA, 'utf-8')
    const bridgePath = 'lua/ge/extensions/beammpCMBridge.lua'
    const bridgeNameBytes = Buffer.from(bridgePath, 'utf-8')
    const bridgeCrc = crc32(bridgeContent)
    let bridgeOffset = 0
    if (!bridgeAlreadyCurrent) {
      const bridgeHdr = Buffer.alloc(30 + bridgeNameBytes.length)
      bridgeHdr.writeUInt32LE(0x04034b50, 0)
      bridgeHdr.writeUInt16LE(20, 4)
      bridgeHdr.writeUInt32LE(bridgeCrc, 14)
      bridgeHdr.writeUInt32LE(bridgeContent.length, 18)
      bridgeHdr.writeUInt32LE(bridgeContent.length, 22)
      bridgeHdr.writeUInt16LE(bridgeNameBytes.length, 26)
      bridgeNameBytes.copy(bridgeHdr, 30)
      bridgeOffset = outOff
      locals.push(Buffer.concat([bridgeHdr, bridgeContent]))
      outOff += bridgeHdr.length + bridgeContent.length
    }

    // Rebuild central directory
    const cdStart = outOff
    const cdParts: Buffer[] = []
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      const mod = modified.get(i)
      if (mod) {
        // New CD entry for modified file
        const nameBytes = Buffer.from(e.name, 'utf-8')
        const cd = Buffer.alloc(46 + nameBytes.length)
        cd.writeUInt32LE(0x02014b50, 0)
        cd.writeUInt16LE(20, 4)
        cd.writeUInt16LE(20, 6)
        cd.writeUInt32LE(mod.newCrc, 16)
        cd.writeUInt32LE(mod.content.length, 20)
        cd.writeUInt32LE(mod.content.length, 24)
        cd.writeUInt16LE(nameBytes.length, 28)
        cd.writeUInt32LE(offsets[i], 42)
        nameBytes.copy(cd, 46)
        cdParts.push(cd)
      } else {
        // Copy original CD entry with updated offset
        const cdBuf = Buffer.from(source.subarray(e.cdPos, e.cdPos + e.cdLen))
        cdBuf.writeUInt32LE(offsets[i], 42)
        cdParts.push(cdBuf)
      }
    }

    // CD entry for bridge (only if newly added)
    if (!bridgeAlreadyCurrent) {
      const bridgeCD = Buffer.alloc(46 + bridgeNameBytes.length)
      bridgeCD.writeUInt32LE(0x02014b50, 0)
      bridgeCD.writeUInt16LE(20, 4)
      bridgeCD.writeUInt16LE(20, 6)
      bridgeCD.writeUInt32LE(bridgeCrc, 16)
      bridgeCD.writeUInt32LE(bridgeContent.length, 20)
      bridgeCD.writeUInt32LE(bridgeContent.length, 24)
      bridgeCD.writeUInt16LE(bridgeNameBytes.length, 28)
      bridgeCD.writeUInt32LE(bridgeOffset, 42)
      bridgeNameBytes.copy(bridgeCD, 46)
      cdParts.push(bridgeCD)
    }

    const cdSize = cdParts.reduce((s, b) => s + b.length, 0)
    const totalEntries = entries.length + (bridgeAlreadyCurrent ? 0 : 1)

    // EOCD
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(totalEntries, 8)
    eocd.writeUInt16LE(totalEntries, 10)
    eocd.writeUInt32LE(cdSize, 12)
    eocd.writeUInt32LE(cdStart, 16)

    this.log(`Patched BeamMP.zip: injected bridge extension (${totalEntries} entries)`)
    return Buffer.concat([...locals, ...cdParts, eocd])
  }

  private waitForGameReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.gameInitialized && this.coreSocket && !this.coreSocket.destroyed) {
        resolve()
        return
      }
      const timeout = setTimeout(() => {
        this.gameReadyResolve = null
        reject(new Error('Timeout waiting for game mod init'))
      }, 120000)
      this.gameReadyResolve = () => {
        clearTimeout(timeout)
        resolve()
      }
    })
  }

  async loginAsGuest(): Promise<void> {
    try {
      const resp = await fetch(`${this.authUrl}/userlogin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Guest: 'Name' })
      })
      const body = await resp.text()
      if (body && body[0] === '{') {
        const d = JSON.parse(body)
        if (d.success) {
          this.loginAuth = true
          if (d.username) this.username = d.username
          if (d.role) this.userRole = d.role
          if (d.id !== undefined) this.userId = d.id
          if (d.public_key) this.publicKey = d.public_key
          if (d.private_key) this.saveKey(d.private_key)
          this.log(`Logged in as ${this.username}`)
          return
        }
      }
    } catch (err) {
      this.log(`ERROR: Guest auth failed: ${err}`)
    }
    // Fallback if auth fails
    this.loginAuth = true
    this.username = 'Guest'
    this.userRole = ''
    this.userId = -1
    this.publicKey = ''
    this.log('Guest auth fallback (no server assigned name)')
  }

  async loginToBeamMP(username: string, password: string): Promise<{ success: boolean; username?: string; error?: string }> {
    try {
      const resp = await fetch(`${this.authUrl}/userlogin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const body = await resp.text()
      if (!body || body[0] !== '{') {
        return { success: false, error: 'Invalid auth response' }
      }
      const d = JSON.parse(body)
      if (d.success) {
        this.loginAuth = true
        if (d.username) this.username = d.username
        if (d.role) this.userRole = d.role
        if (d.id !== undefined) this.userId = d.id
        if (d.private_key) this.saveKey(d.private_key)
        if (d.public_key) this.publicKey = d.public_key
        this.log(`Logged in as ${d.username}`)
        return { success: true, username: d.username }
      }
      return { success: false, error: d.message || 'Authentication failed' }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  getAuthInfo(): { authenticated: boolean; username: string; guest: boolean } {
    return {
      authenticated: this.loginAuth,
      username: this.username,
      guest: this.loginAuth && !this.publicKey
    }
  }

  logoutBeamMP(): void {
    this.loginAuth = false
    this.username = ''
    this.userRole = ''
    this.userId = -1
    this.publicKey = ''
    this.privateKey = ''
    this.saveKey(null)
    this.log('Logged out')
  }

  setCorePort(port: number): void {
    this.corePort = port
  }

  // ── GPS Tracker ──

  deployGPSTracker(userDir: string): { success: boolean; error?: string } {
    try {
      const extDir = join(userDir, 'lua', 'ge', 'extensions')
      mkdirSync(extDir, { recursive: true })
      writeFileSync(join(extDir, 'beamcmGPS.lua'), GPS_TRACKER_GE_LUA.trim())
      // Write signal so the running bridge can hot-load it mid-game
      const signalDir = join(userDir, 'settings', 'BeamCM')
      mkdirSync(signalDir, { recursive: true })
      writeFileSync(join(signalDir, 'gps_signal.json'), JSON.stringify({ action: 'load', processed: false }))
      // Clear stale telemetry from previous session so the UI doesn't show old data
      const staleTelemetry = join(signalDir, 'gps_telemetry.json')
      if (existsSync(staleTelemetry)) unlinkSync(staleTelemetry)
      this.latestGpsTelemetry = null
      this.gpsTrackerDeployed = true
      this.log('GPS tracker deployed to ' + join(extDir, 'beamcmGPS.lua'))
      this.startGpsFilePoller(userDir)
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to deploy GPS tracker: ${err}` }
    }
  }

  undeployGPSTracker(userDir: string): { success: boolean; error?: string } {
    try {
      // Write unload signal so the running bridge can hot-unload it mid-game
      const signalDir = join(userDir, 'settings', 'BeamCM')
      mkdirSync(signalDir, { recursive: true })
      writeFileSync(join(signalDir, 'gps_signal.json'), JSON.stringify({ action: 'unload', processed: false }))
      const extPath = join(userDir, 'lua', 'ge', 'extensions', 'beamcmGPS.lua')
      if (existsSync(extPath)) unlinkSync(extPath)
      // Clean up telemetry file
      const telemetryPath = join(userDir, 'settings', 'BeamCM', 'gps_telemetry.json')
      if (existsSync(telemetryPath)) unlinkSync(telemetryPath)
      this.gpsTrackerDeployed = false
      this.latestGpsTelemetry = null
      this.stopGpsFilePoller()
      this.log('GPS tracker undeployed')
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to undeploy GPS tracker: ${err}` }
    }
  }

  isGPSTrackerDeployed(): boolean {
    return this.gpsTrackerDeployed
  }

  getGPSTelemetry(): import('../../shared/types').GPSTelemetry | null {
    return this.latestGpsTelemetry
  }

  private startGpsFilePoller(userDir: string): void {
    if (this.gpsFilePoller) return
    const telemetryPath = join(userDir, 'settings', 'BeamCM', 'gps_telemetry.json')
    let lastT = 0
    let lastUpdateTime = Date.now()
    const STALE_TIMEOUT = 3000 // 3 seconds with no new data → game is loading/transitioning
    this.gpsFilePoller = setInterval(() => {
      try {
        if (!existsSync(telemetryPath)) {
          // File gone (deleted on deploy or undeploy) — clear telemetry
          if (this.latestGpsTelemetry) {
            this.latestGpsTelemetry = null
            lastT = 0
          }
          return
        }
        const raw = readFileSync(telemetryPath, 'utf-8')
        const data = JSON.parse(raw)
        if (typeof data.x !== 'number' || typeof data.y !== 'number') return
        // Deduplicate: only update if the Lua-side timestamp changed
        if (data.t === lastT) {
          // Stale check: if the Lua side stopped writing (map change / no vehicle), clear telemetry
          if (this.latestGpsTelemetry && Date.now() - lastUpdateTime > STALE_TIMEOUT) {
            this.latestGpsTelemetry = null
          }
          return
        }
        lastT = data.t
        lastUpdateTime = Date.now()
        this.latestGpsTelemetry = {
          x: data.x,
          y: data.y,
          z: data.z ?? 0,
          heading: data.heading ?? 0,
          speed: data.speed ?? 0,
          timestamp: Date.now(),
          map: typeof data.map === 'string' && data.map ? data.map : undefined,
          otherPlayers: Array.isArray(data.others) ? data.others.map((o: Record<string, unknown>) => ({
            x: typeof o.x === 'number' ? o.x : 0,
            y: typeof o.y === 'number' ? o.y : 0,
            z: typeof o.z === 'number' ? o.z : 0,
            heading: typeof o.heading === 'number' ? o.heading : 0,
            speed: typeof o.speed === 'number' ? o.speed : 0,
            name: typeof o.name === 'string' ? o.name : ''
          })) : undefined,
          navRoute: Array.isArray(data.route) ? data.route.filter((pt: Record<string, unknown>) =>
            typeof pt.x === 'number' && typeof pt.y === 'number'
          ).map((pt: Record<string, unknown>) => ({ x: pt.x as number, y: pt.y as number })) : undefined
        }
      } catch { /* file may be mid-write, skip this tick */ }
    }, 100) // 10 Hz polling
    this.log('GPS file poller started on ' + telemetryPath)
  }

  private stopGpsFilePoller(): void {
    if (this.gpsFilePoller) {
      clearInterval(this.gpsFilePoller)
      this.gpsFilePoller = null
    }
  }

  private shutdown(): void {
    this.stopGpsFilePoller()
    this.netReset()
    if (this.coreSocket) {
      this.coreSocket.destroy()
      this.coreSocket = null
    }
    if (this.coreServer) {
      this.coreServer.close()
      this.coreServer = null
    }
    if (this.httpProxy) {
      this.httpProxy.close()
      this.httpProxy = null
    }
  }
}
