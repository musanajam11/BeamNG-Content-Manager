/**
 * Framing helpers for the CM-to-CM session transport.
 *
 * Wire format: 4-byte big-endian unsigned length prefix + UTF-8 JSON payload.
 * This is used by both `EditorSyncRelayService` (host side, accepts peers)
 * and `PeerClient` (joiner side, dials host).
 *
 * Max payload: 2 MiB (late-join baseline chunks are split below this).
 */

import { Socket } from 'net'

export const MAX_FRAME_BYTES = 2 * 1024 * 1024

export type SessionMessage =
  | HelloMsg
  | WelcomeMsg
  | OpMsg
  | AckMsg
  | LeaveMsg
  | PingMsg
  | PongMsg
  | ErrorMsg
  | PoseMsg

export interface HelloMsg {
  type: 'hello'
  protocol: 1
  authorId: string
  displayName?: string
  token?: string
  fromSeq?: number
}

export interface WelcomeMsg {
  type: 'welcome'
  authorId: string            // the host's own authorId
  yourAuthorId: string        // assigned to the joiner (echoes hello.authorId)
  peers: Array<{ authorId: string; displayName?: string }>
  lastSeq: number
  levelName?: string | null
}

export interface OpMsg {
  type: 'op'
  seq: number
  authorId: string
  clientOpId?: string
  kind: 'do' | 'undo' | 'redo'
  name?: string
  data?: unknown
  detail?: string
  targets?: unknown[]
  ts?: number
}

export interface AckMsg {
  type: 'ack'
  clientOpId: string
  seq: number
  status: 'ok' | string
}

export interface LeaveMsg {
  type: 'leave'
  authorId: string
  reason?: string
}

export interface PingMsg { type: 'ping'; ts: number }
export interface PongMsg { type: 'pong'; ts: number }
export interface ErrorMsg { type: 'error'; code: string; message: string }

/**
 * Ephemeral peer-presence update. Not sequenced, not logged, not ack'd.
 * Relay rebroadcasts to other peers; last-write-wins per `authorId`.
 * Sent at ~5 Hz while a peer is active in the editor.
 */
export interface PoseMsg {
  type: 'pose'
  authorId: string
  displayName?: string
  /** Wall-clock ms (sender side). */
  ts: number
  /** Camera / vehicle position in world space. */
  x: number
  y: number
  z: number
  /** Heading in radians (yaw), if known. */
  heading?: number
  /** `true` when the peer is currently driving a vehicle. */
  inVehicle?: boolean
  /** Vehicle display name ("etk800", "pickup", …) if inVehicle. */
  vehicle?: string
  /** Currently loaded level name — for mismatch detection. */
  levelName?: string | null
}

/** Encode one message to a length-prefixed frame buffer. */
export function encodeFrame(msg: SessionMessage): Buffer {
  const json = Buffer.from(JSON.stringify(msg), 'utf8')
  if (json.length > MAX_FRAME_BYTES) {
    throw new Error(`SessionTransport: frame too large (${json.length} > ${MAX_FRAME_BYTES})`)
  }
  const out = Buffer.allocUnsafe(4 + json.length)
  out.writeUInt32BE(json.length, 0)
  json.copy(out, 4)
  return out
}

/**
 * Streaming decoder. Feed raw socket chunks via `push(chunk)`; it calls
 * `onMessage` once per complete frame parsed. On protocol violation the
 * provided `onError` runs and further input is rejected.
 */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0)
  private broken = false

  constructor(
    private readonly onMessage: (msg: SessionMessage) => void,
    private readonly onError: (err: Error) => void
  ) {}

  push(chunk: Buffer): void {
    if (this.broken) return
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0)
      if (len > MAX_FRAME_BYTES) {
        this.broken = true
        this.onError(new Error(`frame length ${len} exceeds max ${MAX_FRAME_BYTES}`))
        return
      }
      if (this.buf.length < 4 + len) return
      const payload = this.buf.subarray(4, 4 + len)
      this.buf = this.buf.subarray(4 + len)
      let msg: SessionMessage
      try {
        msg = JSON.parse(payload.toString('utf8')) as SessionMessage
      } catch (err) {
        this.broken = true
        this.onError(err as Error)
        return
      }
      try {
        this.onMessage(msg)
      } catch (err) {
        // Handler threw — surface and keep parsing.
        this.onError(err as Error)
      }
    }
  }
}

/** Send one message over a socket. Returns false if the socket is closed. */
export function sendMessage(sock: Socket | null, msg: SessionMessage): boolean {
  if (!sock || sock.destroyed) return false
  try {
    sock.write(encodeFrame(msg))
    return true
  } catch {
    return false
  }
}
