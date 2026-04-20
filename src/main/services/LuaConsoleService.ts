/**
 * Lua Console Service — full live Lua REPL between CM and BeamNG.drive.
 *
 * Bridges the renderer's <LuaConsolePage> to a deployed `beamcmConsole.lua`
 * extension via the same TCP pattern used for voice chat. Each line is a
 * newline-terminated text frame:
 *
 *   CM → Lua:
 *     E|<reqId>|<luaSource>\n        execute (any expression or statement)
 *     V|<reqId>|<varName>\n          inspect a global / table path
 *     S|<scope>\n                    switch GE/Vehicle Lua scope (ge|veh)
 *     C|\n                           clear remote print buffer
 *
 *   Lua → CM:
 *     R|<reqId>|<status>|<repr>\n    result (status = ok|err)
 *     L|<level>|<source>|<msg>\n     captured log line (I/W/E/D)
 *     P|<text>\n                     captured print() output
 *     H|\n                           heartbeat
 */

import { writeFile, mkdir } from 'fs/promises'
import { existsSync, mkdirSync, unlinkSync, writeFileSync, statSync, watch, type FSWatcher, createReadStream } from 'fs'
import { join } from 'path'
import { BrowserWindow } from 'electron'
import { createServer, type Server, type Socket } from 'net'
import { createInterface, type Interface as ReadlineInterface } from 'readline'

import { LUA_CONSOLE_EXTENSION } from './LuaConsoleExtension'

export type LuaScope = 'ge' | 'veh'

export interface LuaConsoleResult {
  reqId: number
  status: 'ok' | 'err'
  repr: string
}

export interface LuaConsoleLog {
  kind: 'log' | 'print'
  level?: 'I' | 'W' | 'E' | 'D'
  source?: string
  text: string
  at: number
}

export class LuaConsoleService {
  private server: Server | null = null
  private client: Socket | null = null
  private rl: ReadlineInterface | null = null
  private port = 0
  private portFile: string | null = null
  private deployed = false
  private userDir: string | null = null
  private pending: string[] = []
  private static readonly PENDING_CAP = 256
  private deployInFlight: Promise<{ success: boolean; error?: string; port?: number }> | null = null

  // beamng.log tailer
  private logTailWatcher: FSWatcher | null = null
  private logTailPath: string | null = null
  private logTailOffset = 0
  private logTailBuffer = ''
  private logTailReading = false
  private logTailRetry: NodeJS.Timeout | null = null

  private getWindow(): BrowserWindow | null {
    const wins = BrowserWindow.getAllWindows()
    return wins.length > 0 ? wins[0] : null
  }

  private log(msg: string): void {
    console.log(`[LuaConsole] ${msg}`)
  }

  private get signalDir(): string {
    return join(this.userDir!, 'settings', 'BeamCM')
  }

  private get extensionPath(): string {
    return join(this.userDir!, 'lua', 'ge', 'extensions', 'beamcmConsole.lua')
  }

  isDeployed(): boolean {
    return this.deployed
  }

  isConnected(): boolean {
    return this.client !== null && !this.client.destroyed
  }

  async deploy(userDir: string): Promise<{ success: boolean; error?: string; port?: number }> {
    // Idempotent: if already deployed (and the bridge is still listening),
    // re-emit the load signal and return the existing port. If a deploy
    // is already in-flight, share its promise to prevent racing callers
    // from spawning multiple TCP servers.
    if (this.deployed && this.server && this.userDir === userDir) {
      try {
        mkdirSync(this.signalDir, { recursive: true })
        writeFileSync(
          join(this.signalDir, 'console_signal.json'),
          JSON.stringify({ action: 'load', processed: false }),
          'utf-8',
        )
      } catch { /* best-effort */ }
      return { success: true, port: this.port }
    }
    if (this.deployInFlight) return this.deployInFlight
    this.deployInFlight = this.doDeploy(userDir)
    try {
      return await this.deployInFlight
    } finally {
      this.deployInFlight = null
    }
  }

  private async doDeploy(userDir: string): Promise<{ success: boolean; error?: string; port?: number }> {
    try {
      this.userDir = userDir
      const extDir = join(userDir, 'lua', 'ge', 'extensions')
      await mkdir(extDir, { recursive: true })
      await writeFile(join(extDir, 'beamcmConsole.lua'), LUA_CONSOLE_EXTENSION.trim(), 'utf-8')
      mkdirSync(this.signalDir, { recursive: true })
      const port = await this.startBridge()
      // Tell the running CM bridge (if any) to hot-load the console extension
      try {
        writeFileSync(
          join(this.signalDir, 'console_signal.json'),
          JSON.stringify({ action: 'load', processed: false }),
          'utf-8',
        )
      } catch { /* best-effort */ }
      // Start tailing beamng.log so the console mirrors EVERYTHING the
      // in-game console would show, including engine/extension messages
      // that bypass our _G.print/_G.log wrappers.
      this.startLogTail(userDir)
      this.deployed = true
      this.log(`Deployed extension and listening on 127.0.0.1:${port}`)
      return { success: true, port }
    } catch (err) {
      return { success: false, error: `Failed to deploy lua console: ${err}` }
    }
  }

  undeploy(): { success: boolean; error?: string } {
    try {
      // Ask the running bridge to unload the extension before we delete it
      if (this.userDir) {
        try {
          mkdirSync(this.signalDir, { recursive: true })
          writeFileSync(
            join(this.signalDir, 'console_signal.json'),
            JSON.stringify({ action: 'unload', processed: false }),
            'utf-8',
          )
        } catch { /* best-effort */ }
      }
      this.stopLogTail()
      this.stopBridge()
      if (this.userDir && existsSync(this.extensionPath)) {
        unlinkSync(this.extensionPath)
      }
      if (this.userDir) {
        const f = join(this.signalDir, 'lc_port.txt')
        if (existsSync(f)) unlinkSync(f)
      }
      this.deployed = false
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to undeploy lua console: ${err}` }
    }
  }

  private async startBridge(): Promise<number> {
    if (this.server) return this.port
    return new Promise<number>((resolve, reject) => {
      const server = createServer((socket) => this.attach(socket))
      server.on('error', (err) => {
        console.error('[LuaConsole] server error', err)
      })
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (typeof addr !== 'object' || addr === null) {
          reject(new Error('LuaConsole: failed to acquire port'))
          return
        }
        this.server = server
        this.port = addr.port
        this.portFile = join(this.signalDir, 'lc_port.txt')
        try {
          writeFileSync(this.portFile, String(this.port), 'utf-8')
        } catch (e) {
          reject(e)
          return
        }
        resolve(this.port)
      })
    })
  }

  private stopBridge(): void {
    if (this.client) {
      try { this.client.destroy() } catch { /* ignore */ }
    }
    this.client = null
    this.rl?.close()
    this.rl = null
    if (this.server) {
      try { this.server.close() } catch { /* ignore */ }
      this.server = null
    }
    this.pending = []
  }

  // ---------- beamng.log tailer ----------

  private startLogTail(userDir: string): void {
    this.stopLogTail()
    const candidates = [
      join(userDir, 'beamng.log'),
      join(userDir, 'BeamNG.drive.log'),
    ]
    const path = candidates.find((p) => existsSync(p)) ?? candidates[0]
    this.logTailPath = path
    try {
      // Start from end of file so we don't dump existing history
      this.logTailOffset = existsSync(path) ? statSync(path).size : 0
    } catch {
      this.logTailOffset = 0
    }
    this.logTailBuffer = ''
    this.attachLogTailWatcher()
  }

  private attachLogTailWatcher(): void {
    if (!this.logTailPath) return
    try {
      // Watch directory + file name so we survive log rotation
      this.logTailWatcher = watch(this.logTailPath, { persistent: false }, () => {
        this.readLogTail()
      })
      // Initial read in case file already grew before watcher attached
      this.readLogTail()
    } catch {
      // File may not exist yet; retry shortly
      this.logTailRetry = setTimeout(() => {
        this.logTailRetry = null
        if (this.logTailPath) this.attachLogTailWatcher()
      }, 1000)
    }
  }

  private readLogTail(): void {
    if (!this.logTailPath || this.logTailReading) return
    const path = this.logTailPath
    let size = 0
    try { size = statSync(path).size } catch { return }
    if (size < this.logTailOffset) {
      // Truncated/rotated — restart from beginning
      this.logTailOffset = 0
      this.logTailBuffer = ''
    }
    if (size === this.logTailOffset) return
    this.logTailReading = true
    const stream = createReadStream(path, { start: this.logTailOffset, end: size - 1, encoding: 'utf-8' })
    stream.on('data', (chunk: string | Buffer) => {
      this.logTailBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
    })
    stream.on('end', () => {
      this.logTailOffset = size
      this.flushLogTailBuffer()
      this.logTailReading = false
    })
    stream.on('error', () => { this.logTailReading = false })
  }

  private flushLogTailBuffer(): void {
    const lines = this.logTailBuffer.split(/\r?\n/)
    this.logTailBuffer = lines.pop() ?? ''
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    for (const line of lines) {
      const parsed = this.parseBeamngLogLine(line)
      if (!parsed) continue
      const payload: LuaConsoleLog = {
        kind: 'log',
        level: parsed.level,
        source: parsed.source,
        text: parsed.text,
        at: Date.now(),
      }
      win.webContents.send('luaConsole:log', payload)
    }
  }

  // BeamNG log line shape examples:
  //   12:34:56.789|I|main|Initializing engine ...
  //   12:34:56.789|E|GELua.foo|stack traceback ...
  //   plain text (legacy / partial flush)
  private parseBeamngLogLine(line: string): { level?: 'I' | 'W' | 'E' | 'D'; source?: string; text: string } | null {
    if (!line || !line.trim()) return null
    const m = /^\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\|([IWED])\|([^|]*)\|(.*)$/.exec(line)
    if (m) {
      const lvl = m[1] as 'I' | 'W' | 'E' | 'D'
      return { level: lvl, source: m[2] || undefined, text: m[3] }
    }
    return { text: line }
  }

  private stopLogTail(): void {
    if (this.logTailWatcher) {
      try { this.logTailWatcher.close() } catch { /* ignore */ }
      this.logTailWatcher = null
    }
    if (this.logTailRetry) {
      clearTimeout(this.logTailRetry)
      this.logTailRetry = null
    }
    this.logTailPath = null
    this.logTailOffset = 0
    this.logTailBuffer = ''
    this.logTailReading = false
  }

  private attach(socket: Socket): void {
    if (this.client) {
      try { this.client.destroy() } catch { /* ignore */ }
      this.rl?.close()
    }
    this.client = socket
    socket.setNoDelay(true)
    socket.on('error', (err) => console.warn('[LuaConsole] socket error', err.message))
    socket.on('close', () => {
      if (this.client === socket) {
        this.client = null
        this.rl?.close()
        this.rl = null
        this.notifyConnection(false)
      }
    })
    this.rl = createInterface({ input: socket, crlfDelay: Infinity })
    this.rl.on('line', (raw) => this.dispatch(raw))
    this.log('Lua client connected')
    this.notifyConnection(true)
    if (this.pending.length > 0) {
      for (const line of this.pending) socket.write(line)
      this.pending = []
    }
  }

  private notifyConnection(connected: boolean): void {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    win.webContents.send('luaConsole:connection', { connected })
  }

  private dispatch(line: string): void {
    if (!line) return
    const t = line.charCodeAt(0)
    if (t === 0x52 /* R */) {
      // R|reqId|status|repr   (repr was escapeFrame'd Lua-side)
      const p1 = line.indexOf('|', 2)
      if (p1 < 0) return
      const p2 = line.indexOf('|', p1 + 1)
      if (p2 < 0) return
      const reqId = parseInt(line.substring(2, p1), 10)
      const status = line.substring(p1 + 1, p2) as 'ok' | 'err'
      const repr = LuaConsoleService.unescapeFrame(line.substring(p2 + 1))
      const win = this.getWindow()
      win?.webContents.send('luaConsole:result', { reqId, status, repr } as LuaConsoleResult)
      return
    }
    if (t === 0x4c /* L */) {
      // L|level|source|msg
      const p1 = line.indexOf('|', 2)
      if (p1 < 0) return
      const p2 = line.indexOf('|', p1 + 1)
      if (p2 < 0) return
      const level = line.substring(2, p1) as 'I' | 'W' | 'E' | 'D'
      const source = line.substring(p1 + 1, p2)
      const text = LuaConsoleService.unescapeFrame(line.substring(p2 + 1))
      const win = this.getWindow()
      win?.webContents.send('luaConsole:log', {
        kind: 'log', level, source, text, at: Date.now()
      } as LuaConsoleLog)
      return
    }
    if (t === 0x50 /* P */) {
      const text = LuaConsoleService.unescapeFrame(line.substring(2))
      const win = this.getWindow()
      win?.webContents.send('luaConsole:log', {
        kind: 'print', text, at: Date.now()
      } as LuaConsoleLog)
      return
    }
    if (t === 0x48 /* H */) return // heartbeat
  }

  /** Reverse of the Lua escapeFrame: \\n -> LF, \\r -> CR, \\\\ -> \\. */
  private static unescapeFrame(s: string): string {
    const out: string[] = []
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (c === '\\' && i + 1 < s.length) {
        const n = s[i + 1]
        if (n === 'n') { out.push('\n'); i++; continue }
        if (n === 'r') { out.push('\r'); i++; continue }
        if (n === '\\') { out.push('\\'); i++; continue }
      }
      out.push(c)
    }
    return out.join('')
  }

  private write(line: string): void {
    if (this.client && !this.client.destroyed) {
      this.client.write(line)
      return
    }
    if (this.pending.length >= LuaConsoleService.PENDING_CAP) this.pending.shift()
    this.pending.push(line)
  }

  /** Execute Lua source. reqId is correlated back via 'R|reqId|...'. */
  execute(reqId: number, source: string): void {
    // newlines inside source must be escaped to keep frame on one line
    const safe = source.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n')
    this.write(`E|${reqId}|${safe}\n`)
  }

  /** Inspect a variable path (e.g. "be", "core_vehicles", "scenetree.findObject"). */
  inspect(reqId: number, path: string): void {
    const safe = path.replace(/\r?\n/g, ' ')
    this.write(`V|${reqId}|${safe}\n`)
  }

  /** Switch between Game-Engine and Vehicle Lua execution scope. */
  setScope(scope: LuaScope, vehId?: number | null): void {
    if (vehId != null && Number.isFinite(vehId)) {
      this.write(`S|${scope}|${vehId}\n`)
    } else {
      this.write(`S|${scope}\n`)
    }
  }

  /** Ask Lua side to clear its print/log capture buffer. */
  clearBuffer(): void {
    this.write(`C|\n`)
  }

  /** Ask Lua side for tab-completion candidates at `prefix`. */
  complete(reqId: number, prefix: string): void {
    const safe = prefix.replace(/\r?\n/g, ' ')
    this.write(`M|${reqId}|${safe}\n`)
  }

  /** One-level table tree inspection. */
  tree(reqId: number, path: string): void {
    const safe = path.replace(/\r?\n/g, ' ')
    this.write(`T|${reqId}|${safe}\n`)
  }

  /** Meta query (e.g. 'vehicles'). Reply lands as a JSON-encoded R| frame. */
  query(reqId: number, q: string): void {
    this.write(`Q|${reqId}|${q}\n`)
  }

  /** Trigger a Lua reload. action: 'ge' | 'veh' | 'env'. */
  reload(reqId: number | null, action: 'ge' | 'veh' | 'env'): void {
    if (reqId != null) {
      this.write(`X|${reqId}|${action}\n`)
    } else {
      this.write(`X|${action}\n`)
    }
  }
}
