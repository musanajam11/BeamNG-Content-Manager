/**
 * Joiner-side TCP client that connects to a remote CM host running
 * `EditorSyncRelayService`. Bidirectional length-prefixed JSON frames.
 *
 * Lifecycle:
 *   connect() → hello → receive welcome → ready
 *   sendOp(env) while ready
 *   on('remoteOp') fires for ops authored by other peers or the host
 *   on('ack') fires for our sent ops
 *   on('leave') when host or another peer drops
 *   disconnect() / close from peer triggers 'closed'
 *
 * Auto-reconnect is intentionally NOT implemented here — Phase 4 will layer a
 * reconnecting wrapper with seq-resume. For now a drop ends the session; user
 * re-joins via the UI.
 */

import { createConnection, type Socket } from 'net'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import {
  FrameDecoder, sendMessage,
  type SessionMessage, type OpMsg, type WelcomeMsg, type PoseMsg,
} from './transports/SessionFrame'

export interface PeerClientConfig {
  host: string
  port: number
  token?: string
  displayName?: string
  /** If set, re-use this authorId across reconnects (Phase 4). */
  authorId?: string
  /** If set, ask host to replay ops from this seq onward (late-join catchup). */
  fromSeq?: number
}

interface Events {
  ready: (welcome: WelcomeMsg) => void
  remoteOp: (op: OpMsg) => void
  remotePose: (pose: PoseMsg) => void
  ack: (info: { clientOpId: string; seq: number; status: string }) => void
  peerLeft: (info: { authorId: string; reason?: string }) => void
  closed: (reason: string) => void
  error: (err: Error) => void
}

export class PeerClient extends EventEmitter {
  private socket: Socket | null = null
  private decoder: FrameDecoder | null = null
  private ready = false
  private authorId = ''
  private hostAuthorId = ''
  private lastSeq = 0
  private pingTimer: NodeJS.Timeout | null = null
  private static readonly PING_INTERVAL_MS = 5000

  override on<E extends keyof Events>(event: E, listener: Events[E]): this {
    return super.on(event, listener)
  }
  override emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): boolean {
    return super.emit(event, ...args)
  }

  isReady(): boolean { return this.ready }
  getAuthorId(): string { return this.authorId }
  getHostAuthorId(): string { return this.hostAuthorId }
  getLastSeq(): number { return this.lastSeq }

  connect(cfg: PeerClientConfig): Promise<WelcomeMsg> {
    if (this.socket) throw new Error('PeerClient: already connected')
    this.authorId = cfg.authorId || randomUUID()

    return new Promise<WelcomeMsg>((resolve, reject) => {
      const socket = createConnection({ host: cfg.host, port: cfg.port }, () => {
        socket.setNoDelay(true)
        sendMessage(socket, {
          type: 'hello',
          protocol: 1,
          authorId: this.authorId,
          displayName: cfg.displayName,
          token: cfg.token,
          fromSeq: cfg.fromSeq,
        })
      })
      this.socket = socket

      let settled = false
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        this.cleanup()
        reject(err)
      }

      this.decoder = new FrameDecoder(
        (msg) => {
          if (!this.ready) {
            if (msg.type === 'welcome') {
              this.ready = true
              this.hostAuthorId = msg.authorId
              this.authorId = msg.yourAuthorId
              this.lastSeq = msg.lastSeq
              settled = true
              this.startPing()
              this.emit('ready', msg)
              resolve(msg)
              return
            }
            if (msg.type === 'error') {
              fail(new Error(`${msg.code}: ${msg.message}`))
              try { socket.destroy() } catch { /* ignore */ }
              return
            }
            // Ignore other pre-welcome frames.
            return
          }
          this.dispatch(msg)
        },
        (err) => {
          if (!settled) fail(err)
          this.emit('error', err)
          try { socket.destroy() } catch { /* ignore */ }
        },
      )
      socket.on('data', (chunk) => this.decoder?.push(chunk))
      socket.on('error', (err) => {
        if (!settled) fail(err)
        this.emit('error', err)
      })
      socket.on('close', () => {
        this.cleanup()
        this.emit('closed', 'peer closed')
        if (!settled) reject(new Error('socket closed before welcome'))
      })
    })
  }

  disconnect(): void {
    if (this.socket) {
      sendMessage(this.socket, { type: 'leave', authorId: this.authorId, reason: 'user' })
      try { this.socket.destroy() } catch { /* ignore */ }
    }
    this.cleanup()
  }

  /** Send an op envelope to the host. No-op if not ready. */
  sendOp(env: {
    kind: 'do' | 'undo' | 'redo'
    clientOpId: string
    name?: string
    data?: unknown
    detail?: string
    targets?: unknown[]
    ts?: number
  }): boolean {
    if (!this.socket || !this.ready) return false
    return sendMessage(this.socket, {
      type: 'op',
      seq: 0,                    // host ignores; will renumber
      authorId: this.authorId,
      clientOpId: env.clientOpId,
      kind: env.kind,
      name: env.name,
      data: env.data,
      detail: env.detail,
      targets: env.targets,
      ts: env.ts,
    })
  }

  /** Send an ephemeral pose update to the host, which rebroadcasts. */
  sendPose(pose: Omit<PoseMsg, 'type' | 'authorId'>): boolean {
    if (!this.socket || !this.ready) return false
    return sendMessage(this.socket, { type: 'pose', authorId: this.authorId, ...pose })
  }

  private dispatch(msg: SessionMessage): void {
    switch (msg.type) {
      case 'op':
        if (msg.seq > this.lastSeq) this.lastSeq = msg.seq
        this.emit('remoteOp', msg)
        return
      case 'pose':
        this.emit('remotePose', msg)
        return
      case 'ack':
        this.emit('ack', { clientOpId: msg.clientOpId, seq: msg.seq, status: msg.status })
        return
      case 'leave':
        this.emit('peerLeft', { authorId: msg.authorId, reason: msg.reason })
        return
      case 'ping':
        sendMessage(this.socket, { type: 'pong', ts: msg.ts })
        return
      case 'pong':
        return
      case 'error':
        this.emit('error', new Error(`${msg.code}: ${msg.message}`))
        return
      default:
        return
    }
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (this.socket && this.ready) {
        sendMessage(this.socket, { type: 'ping', ts: Date.now() })
      }
    }, PeerClient.PING_INTERVAL_MS)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private cleanup(): void {
    this.stopPing()
    this.ready = false
    this.decoder = null
    this.socket = null
  }
}
