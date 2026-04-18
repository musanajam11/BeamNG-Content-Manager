/**
 * VoiceTransport abstraction — phase 1 (foundation) of the hybrid voice
 * chat plan (see Project/Docs/VOICE-CHAT-HYBRID.md).
 *
 * A VoiceTransport carries a stream of Opus-encoded audio frames between
 * the local CM and a single remote peer. The same wire format (Opus
 * 24 kbps mono 48 kHz, 60 ms frames) is used across all tiers so the
 * receiver doesn't care which transport delivered the frame.
 */

/** A single encoded Opus frame ready to send/receive. */
export interface OpusFrame {
  /** Encoded Opus payload (typically ~150-200 bytes for 60 ms @ 24 kbps). */
  data: Uint8Array
  /** Monotonic per-talker sequence number (wraps at 2^16). */
  seq: number
  /** Encoder timestamp in microseconds (matches WebCodecs AudioData). */
  timestampUs: number
}

/** Tier identifier, used by the router and shown to the user as a badge. */
export enum VoiceTier {
  Direct = 1,
  Mesh = 2,
  Server = 3,
}

/** Lifecycle states a transport can be in. */
export type VoiceTransportState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'closed'

export interface VoiceTransportEvents {
  /** Fired when an inbound Opus frame is received from the remote peer. */
  frame: (frame: OpusFrame) => void
  /** Fired on lifecycle state changes. */
  state: (state: VoiceTransportState, reason?: string) => void
  /** Fired with backpressure depth (frames currently queued for send). */
  backpressure: (queueDepth: number) => void
}

/**
 * One-to-one transport between local and a single remote peer.
 *
 * Implementations: WebRtcTransport (P3), MeshDirectTransport,
 * MeshRelayTransport (P5), BeamMpRelayTransport (P2).
 */
export interface VoiceTransport {
  readonly tier: VoiceTier
  readonly remotePlayerId: number
  readonly state: VoiceTransportState

  /** Begin connecting. Resolves once handshake done or rejects on failure. */
  start(): Promise<void>

  /** Send a single encoded Opus frame. May drop oldest if backpressure hits. */
  send(frame: OpusFrame): void

  /** Tear down. Idempotent. */
  close(reason?: string): void

  on<K extends keyof VoiceTransportEvents>(
    event: K,
    handler: VoiceTransportEvents[K],
  ): void

  off<K extends keyof VoiceTransportEvents>(
    event: K,
    handler: VoiceTransportEvents[K],
  ): void
}

/** Codec parameters fixed across all tiers. */
export const VOICE_CODEC = {
  sampleRate: 48_000,
  channels: 1,
  bitrate: 24_000,
  /** Opus frame duration in milliseconds. */
  frameMs: 60,
  /** Samples per frame at 48 kHz. */
  samplesPerFrame: 48_000 * 0.06, // 2880
} as const

/** Helper for Tier badges in UI. */
export const TIER_BADGE: Record<VoiceTier, { emoji: string; label: string }> = {
  [VoiceTier.Direct]: { emoji: '🟢', label: 'Direct' },
  [VoiceTier.Mesh]: { emoji: '🟡', label: 'Mesh' },
  [VoiceTier.Server]: { emoji: '🟠', label: 'Server' },
}
