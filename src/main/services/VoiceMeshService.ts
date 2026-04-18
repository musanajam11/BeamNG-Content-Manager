import net from 'node:net'
import { BrowserWindow } from 'electron'

/**
 * Manages a single TCP listener and a pool of inbound/outbound peer sockets
 * for the mesh voice tier (Tier 2). Bridged to the renderer via IPC because
 * renderer-process JS cannot bind to TCP sockets directly.
 *
 * Wire framing per peer connection: length-prefixed frames.
 *   [4 bytes BE length] [payload bytes]
 *
 * We are codec-agnostic at this layer; payload is opaque (renderer encodes
 * Opus + sequence header, see MeshDirectTransport / MeshRelayTransport).
 *
 * Connection identifier: a string `peerId` chosen by the renderer (typically
 * the BeamMP player id as decimal string). The renderer associates each
 * connection with a remote BeamMP player so that signaling on the existing
 * Lua bridge (`vc_signal`) can drive accept/connect orchestration.
 *
 * Port range: 47000-47999. We try to bind a randomly chosen port in that
 * range and fall back through a few attempts before giving up.
 */

export type MeshSocketState = 'connecting' | 'open' | 'closed' | 'error'

interface MeshConnection {
  peerId: string
  socket: net.Socket
  /** Length of the next frame, or -1 while reading the prefix. */
  pendingLen: number
  buffer: Buffer
}

export interface MeshListenInfo {
  port: number
}

const PORT_MIN = 47000
const PORT_MAX = 47999
const MAX_BIND_ATTEMPTS = 8
const FRAME_HDR = 4
const MAX_FRAME = 8192 // generous; Opus frames are <200 B
const CONNECT_TIMEOUT_MS = 5000

export class VoiceMeshService {
  private server: net.Server | null = null
  private listenPort: number | null = null
  private connections = new Map<string, MeshConnection>()

  /** Try to bind a TCP listener on a random port in the mesh range. */
  async listen(): Promise<MeshListenInfo> {
    if (this.server) return { port: this.listenPort! }

    for (let i = 0; i < MAX_BIND_ATTEMPTS; i++) {
      const port = PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN + 1))
      try {
        await this.tryBind(port)
        this.listenPort = port
        return { port }
      } catch {
        // try another
      }
    }
    throw new Error(`VoiceMeshService: could not bind in ${PORT_MIN}-${PORT_MAX}`)
  }

  /** Stop listening and close all peer connections. */
  stop(): void {
    for (const [, c] of this.connections) {
      try { c.socket.destroy() } catch { /* ignore */ }
    }
    this.connections.clear()
    if (this.server) {
      try { this.server.close() } catch { /* ignore */ }
      this.server = null
    }
    this.listenPort = null
  }

  /**
   * Open an outbound TCP connection to a remote mesh peer.
   * `peerId` identifies the remote (used locally to route inbound frames).
   * `selfPeerId` is sent as the preamble so the remote knows who we are.
   */
  async connect(peerId: string, host: string, port: number, selfPeerId: string): Promise<void> {
    if (this.connections.has(peerId)) return
    if (!selfPeerId || selfPeerId.length === 0 || selfPeerId.length > 64) {
      throw new Error('VoiceMeshService.connect: invalid selfPeerId')
    }
    const socket = net.connect({ host, port })
    socket.setNoDelay(true)
    const conn: MeshConnection = {
      peerId,
      socket,
      pendingLen: -1,
      buffer: Buffer.alloc(0),
    }
    this.connections.set(peerId, conn)
    this.wireSocket(conn)

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void): void => {
        if (settled) return
        settled = true
        fn()
      }
      const timer = setTimeout(() => {
        settle(() => {
          socket.off('connect', onConnect)
          socket.off('error', onError)
          try { socket.destroy() } catch { /* ignore */ }
          this.connections.delete(peerId)
          this.broadcastState(peerId, 'error', 'connect timeout')
          reject(new Error('connect timeout'))
        })
      }, CONNECT_TIMEOUT_MS)
      const onConnect = (): void => {
        settle(() => {
          clearTimeout(timer)
          socket.off('error', onError)
          // Send 1-byte length + ASCII selfPeerId preamble.
          const preamble = Buffer.alloc(1 + selfPeerId.length)
          preamble.writeUInt8(selfPeerId.length, 0)
          preamble.write(selfPeerId, 1, 'ascii')
          socket.write(preamble)
          this.broadcastState(peerId, 'open')
          resolve()
        })
      }
      const onError = (err: Error): void => {
        settle(() => {
          clearTimeout(timer)
          socket.off('connect', onConnect)
          this.connections.delete(peerId)
          this.broadcastState(peerId, 'error', err.message)
          reject(err)
        })
      }
      socket.once('connect', onConnect)
      socket.once('error', onError)
    })
  }

  /** Send a payload to a known mesh peer. Drops silently if not open. */
  send(peerId: string, payload: Buffer): boolean {
    const conn = this.connections.get(peerId)
    if (!conn) return false
    if (conn.socket.destroyed || !conn.socket.writable) return false
    const hdr = Buffer.alloc(FRAME_HDR)
    hdr.writeUInt32BE(payload.length, 0)
    return conn.socket.write(Buffer.concat([hdr, payload]))
  }

  /** Disconnect a single peer. */
  disconnect(peerId: string): void {
    const conn = this.connections.get(peerId)
    if (!conn) return
    try { conn.socket.destroy() } catch { /* ignore */ }
    this.connections.delete(peerId)
    this.broadcastState(peerId, 'closed')
  }

  getListenPort(): number | null {
    return this.listenPort
  }

  private tryBind(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => this.onInbound(socket))
      const onError = (err: Error): void => {
        server.removeListener('listening', onListening)
        reject(err)
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        this.server = server
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '0.0.0.0')
    })
  }

  private onInbound(socket: net.Socket): void {
    // Inbound peers identify themselves with a tiny preamble:
    // [1 byte len][N bytes ASCII peerId]
    socket.setNoDelay(true)
    let preambleSeen = false
    let preambleLen = -1
    let preambleBuf = Buffer.alloc(0)

    const onPreData = (chunk: Buffer): void => {
      preambleBuf = Buffer.concat([preambleBuf, chunk])
      if (preambleLen < 0 && preambleBuf.length >= 1) {
        preambleLen = preambleBuf.readUInt8(0)
        if (preambleLen === 0 || preambleLen > 64) {
          socket.destroy()
          return
        }
      }
      if (preambleLen > 0 && preambleBuf.length >= 1 + preambleLen) {
        const peerId = preambleBuf.subarray(1, 1 + preambleLen).toString('ascii')
        const rest = preambleBuf.subarray(1 + preambleLen)
        socket.off('data', onPreData)
        preambleSeen = true
        // Replace any prior connection for this peer (mesh re-handshake).
        const existing = this.connections.get(peerId)
        if (existing) try { existing.socket.destroy() } catch { /* ignore */ }
        const conn: MeshConnection = {
          peerId,
          socket,
          pendingLen: -1,
          buffer: rest,
        }
        this.connections.set(peerId, conn)
        this.wireSocket(conn)
        this.broadcastState(peerId, 'open')
        if (rest.length > 0) this.drainBuffer(conn)
      }
    }

    socket.on('data', onPreData)
    const timeout = setTimeout(() => {
      if (!preambleSeen) socket.destroy()
    }, 5000)
    socket.once('close', () => clearTimeout(timeout))
    socket.once('error', () => { /* swallow; close will fire */ })
  }

  private wireSocket(conn: MeshConnection): void {
    conn.socket.on('data', (chunk: Buffer) => {
      conn.buffer = Buffer.concat([conn.buffer, chunk])
      this.drainBuffer(conn)
    })
    conn.socket.on('close', () => {
      // Only delete the map entry if it still points to *this* connection;
      // a subsequent re-handshake from the same peer may have replaced it.
      if (this.connections.get(conn.peerId) === conn) {
        this.connections.delete(conn.peerId)
      }
      this.broadcastState(conn.peerId, 'closed')
    })
    conn.socket.on('error', (err: Error) => {
      this.broadcastState(conn.peerId, 'error', err.message)
    })
  }

  private drainBuffer(conn: MeshConnection): void {
    for (;;) {
      if (conn.pendingLen < 0) {
        if (conn.buffer.length < FRAME_HDR) return
        conn.pendingLen = conn.buffer.readUInt32BE(0)
        conn.buffer = conn.buffer.subarray(FRAME_HDR)
        if (conn.pendingLen <= 0 || conn.pendingLen > MAX_FRAME) {
          // Bad frame: drop the connection.
          try { conn.socket.destroy() } catch { /* ignore */ }
          return
        }
      }
      if (conn.buffer.length < conn.pendingLen) return
      const payload = conn.buffer.subarray(0, conn.pendingLen)
      conn.buffer = conn.buffer.subarray(conn.pendingLen)
      conn.pendingLen = -1
      this.broadcastData(conn.peerId, payload)
    }
  }

  private broadcastData(peerId: string, data: Buffer): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('voiceMesh:data', { peerId, data })
      }
    }
  }

  private broadcastState(peerId: string, state: MeshSocketState, reason?: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('voiceMesh:state', { peerId, state, reason })
      }
    }
  }
}
