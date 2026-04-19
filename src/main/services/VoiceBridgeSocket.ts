/**
 * Local TCP bridge between CM (Electron main) and the BeamNG Lua extension.
 *
 * Replaces the previous JSON-file polling IPC. The file approach had two
 * compounding failure modes that made voice audio unusable:
 *   1. Read-modify-write race between Lua's `appendIncoming` and CM's
 *      "read then truncate to []" pattern → frames silently lost or
 *      duplicated.
 *   2. 50 ms poll on Lua side + 50 ms poll on CM side + JSON parse/stringify
 *      per batch → 100+ ms of jitter on top of network jitter, causing
 *      the JitterBuffer to underrun and emit silence (chop).
 *
 * Wire protocol — newline-delimited text frames in BOTH directions:
 *   S|event|data\n         signal (e.g. S|vc_signal|3|{...})
 *   A|seq|b64\n            outbound audio (CM → Lua → BeamMP server)
 *   R|fromId|seq|b64\n     inbound audio  (BeamMP → Lua → CM)
 *   H|\n                   heartbeat / handshake from Lua
 *
 * Why text instead of binary length-prefix:
 *   - LuaSocket in BeamNG can read lines with `client:receive('*l')` cheaply.
 *   - Audio is base64 anyway because the BeamMP server hop carries it as
 *     a Lua string. Switching that to raw bytes is a separate refactor;
 *     this change targets only the Lua↔CM hop.
 *   - Newline framing tolerates partial reads automatically via Node's
 *     readline (`createInterface`) and Lua's line-mode receive.
 */

import { createServer, type Server, type Socket } from 'net'
import { createInterface, type Interface as ReadlineInterface } from 'readline'
import { writeFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'

export type SignalHandler = (event: string, data: string) => void
export type AudioHandler = (fromId: number, seq: number, b64: string) => void

export class VoiceBridgeSocket {
  private server: Server | null = null
  private client: Socket | null = null
  private rl: ReadlineInterface | null = null
  private port = 0
  private portFile: string | null = null

  private signalHandler: SignalHandler | null = null
  private audioHandler: AudioHandler | null = null
  private connectHandler: (() => void) | null = null

  /** Buffered messages while no client is connected (capped). */
  private pending: string[] = []
  private static readonly PENDING_CAP = 256

  /** Open the listener and write the port file. Idempotent. */
  async start(beamcmDir: string): Promise<number> {
    if (this.server) return this.port
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.attach(socket))
      server.on('error', (err) => {
        console.error('[VoiceBridge] server error', err)
      })
      // Bind to loopback only on a random port to avoid collisions and to
      // keep the bridge reachable strictly from the local game process.
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (typeof addr !== 'object' || addr === null) {
          reject(new Error('VoiceBridge: failed to acquire port'))
          return
        }
        this.server = server
        this.port = addr.port
        this.portFile = join(beamcmDir, 'vc_port.txt')
        try {
          writeFileSync(this.portFile, String(this.port), 'utf-8')
        } catch (e) {
          reject(e)
          return
        }
        console.log(`[VoiceBridge] listening on 127.0.0.1:${this.port}`)
        resolve(this.port)
      })
    })
  }

  stop(): void {
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
    if (this.portFile && existsSync(this.portFile)) {
      try { unlinkSync(this.portFile) } catch { /* ignore */ }
    }
    this.pending = []
  }

  isConnected(): boolean {
    return this.client !== null && !this.client.destroyed
  }

  onSignal(h: SignalHandler): void { this.signalHandler = h }
  onAudio(h: AudioHandler): void { this.audioHandler = h }
  onConnect(h: () => void): void { this.connectHandler = h }

  /** Queue a signal for transmission. Drops oldest if no client connected. */
  sendSignal(event: string, data: string): void {
    // Strip newlines defensively — payload is opaque but we need framing safe.
    const safeData = data.replace(/\r?\n/g, ' ')
    this.write(`S|${event}|${safeData}\n`)
  }

  /** Queue an outbound audio frame. b64 must be a single line. */
  sendAudio(seq: number, b64: string): void {
    this.write(`A|${seq}|${b64}\n`)
  }

  private write(line: string): void {
    if (this.client && !this.client.destroyed) {
      // cork+uncork would batch better but Node's tcp socket already
      // coalesces small writes inside the kernel buffer; per-frame writes
      // are fine at 17 fps per peer.
      this.client.write(line)
      return
    }
    // Buffer until first connect so we don't lose `vc_enable` issued
    // before the game side has come up.
    if (this.pending.length >= VoiceBridgeSocket.PENDING_CAP) {
      this.pending.shift()
    }
    this.pending.push(line)
  }

  private attach(socket: Socket): void {
    if (this.client) {
      // Only one Lua extension instance is ever expected. Newer connection
      // wins (e.g. game restart while CM stays running).
      console.log('[VoiceBridge] replacing previous client connection')
      try { this.client.destroy() } catch { /* ignore */ }
      this.rl?.close()
    }
    this.client = socket
    socket.setNoDelay(true) // disable Nagle - we want frames out immediately
    socket.on('error', (err) => {
      console.warn('[VoiceBridge] socket error', err.message)
    })
    socket.on('close', () => {
      if (this.client === socket) {
        console.log('[VoiceBridge] client disconnected')
        this.client = null
        this.rl?.close()
        this.rl = null
      }
    })

    this.rl = createInterface({ input: socket, crlfDelay: Infinity })
    this.rl.on('line', (raw) => this.dispatch(raw))

    console.log(`[VoiceBridge] client connected from ${socket.remoteAddress}:${socket.remotePort}`)

    // Drain any messages buffered before the game came up.
    if (this.pending.length > 0) {
      console.log(`[VoiceBridge] flushing ${this.pending.length} buffered message(s)`)
      for (const line of this.pending) socket.write(line)
      this.pending = []
    }

    this.connectHandler?.()
  }

  private dispatch(line: string): void {
    if (!line) return
    const type = line.charCodeAt(0)
    // Fast-path the common case: 'R' (audio in) is by far the highest volume.
    if (type === 0x52 /* R */) {
      // R|fromId|seq|b64
      const p1 = line.indexOf('|', 2)
      if (p1 < 0) return
      const p2 = line.indexOf('|', p1 + 1)
      if (p2 < 0) return
      const fromId = parseInt(line.substring(2, p1), 10)
      const seq = parseInt(line.substring(p1 + 1, p2), 10)
      const b64 = line.substring(p2 + 1)
      if (Number.isFinite(fromId) && Number.isFinite(seq) && b64.length > 0) {
        this.audioHandler?.(fromId, seq, b64)
      }
      return
    }
    if (type === 0x53 /* S */) {
      // S|event|data
      const p1 = line.indexOf('|', 2)
      if (p1 < 0) return
      const event = line.substring(2, p1)
      const data = line.substring(p1 + 1)
      this.signalHandler?.(event, data)
      return
    }
    if (type === 0x48 /* H */) {
      // Heartbeat — purely informational, ignore payload.
      return
    }
    // Unknown type — log once but don't disconnect.
    console.warn('[VoiceBridge] unknown frame type', JSON.stringify(line.substring(0, 32)))
  }
}
