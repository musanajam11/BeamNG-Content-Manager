/**
 * VoiceTransportRouter — per-peer tier selector.
 *
 * Try tier 1 (WebRTC) for `tier1TimeoutMs`; on failure or timeout, demote
 * to tier 2 (mesh — not in P4) and finally tier 3 (server relay).
 *
 * Tier never auto-promotes within a session. Avoids ping-pong on flaky
 * links. New router → new session → fresh probe.
 */

import { BeamMpRelayTransport } from './transports/BeamMpRelayTransport'
import { WebRtcSignal, WebRtcTransport } from './transports/WebRtcTransport'
import {
  OpusFrame,
  TIER_BADGE,
  VoiceTier,
  VoiceTransport,
  VoiceTransportEvents,
} from './transports/types'

export type RouterEvents = VoiceTransportEvents & {
  tier: (tier: VoiceTier, reason?: string) => void
}

export interface VoiceTransportRouterOptions {
  remotePlayerId: number
  polite: boolean
  iceServers: RTCIceServer[]
  /** Function that ships a tier-1 (WebRTC) signal to the remote. */
  sendWebRtcSignal: (s: WebRtcSignal) => void
  /** Force-disable a tier (e.g. user setting "force minimum tier 1"). */
  disabledTiers?: ReadonlySet<VoiceTier>
  /** Override default 8s WebRTC timeout. */
  tier1TimeoutMs?: number
  /** Force-pin to a specific tier (dev/test). */
  forceTier?: VoiceTier
  /**
   * Optional factory that returns a Tier-2 (mesh) transport for this peer,
   * or null if mesh isn't viable. Wired by the store from MeshOrchestrator.
   */
  meshFactory?: () => VoiceTransport | null
}

export class VoiceTransportRouter {
  readonly remotePlayerId: number
  private opts: VoiceTransportRouterOptions
  private current: VoiceTransport | null = null
  private currentTier: VoiceTier | null = null
  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  private deadTiers = new Set<VoiceTier>()
  private closed = false

  constructor(opts: VoiceTransportRouterOptions) {
    this.opts = opts
    this.remotePlayerId = opts.remotePlayerId
    if (opts.disabledTiers) {
      for (const t of opts.disabledTiers) this.deadTiers.add(t)
    }
  }

  on<K extends keyof RouterEvents>(ev: K, h: RouterEvents[K]): void {
    ;(this.listeners[ev] ||= []).push(h as (...a: unknown[]) => void)
  }

  off<K extends keyof RouterEvents>(ev: K, h: RouterEvents[K]): void {
    const arr = this.listeners[ev]
    if (!arr) return
    const idx = arr.indexOf(h as (...a: unknown[]) => void)
    if (idx >= 0) arr.splice(idx, 1)
  }

  private emit<K extends keyof RouterEvents>(ev: K, ...args: Parameters<RouterEvents[K]>): void {
    const arr = this.listeners[ev]
    if (!arr) return
    for (const h of arr) h(...args)
  }

  async start(): Promise<void> {
    if (this.opts.forceTier) {
      await this.tryTier(this.opts.forceTier)
      return
    }
    await this.tryTier(VoiceTier.Direct)
  }

  /** Inject a tier-1 signal arriving via the external signaling channel. */
  async handleWebRtcSignal(s: WebRtcSignal): Promise<void> {
    // Routed only if the active transport is still tier 1.
    if (this.current instanceof WebRtcTransport) {
      await this.current.handleSignal(s)
    } else {
      // Tier 1 is dead; ignore. (Could also re-probe here in the future.)
    }
  }

  send(frame: OpusFrame): void {
    this.current?.send(frame)
  }

  close(reason?: string): void {
    this.closed = true
    this.current?.close(reason)
    this.current = null
    this.currentTier = null
  }

  get tier(): VoiceTier | null {
    return this.currentTier
  }

  private async tryTier(tier: VoiceTier): Promise<void> {
    if (this.closed) return
    if (this.deadTiers.has(tier)) {
      await this.demoteFrom(tier, `tier ${tier} disabled`)
      return
    }
    this.current?.close('switching tiers')

    const transport = this.buildTransport(tier)
    if (!transport) {
      await this.demoteFrom(tier, `tier ${tier} unavailable`)
      return
    }
    this.current = transport
    this.currentTier = tier

    transport.on('frame', (f) => this.emit('frame', f))
    transport.on('backpressure', (n) => this.emit('backpressure', n))
    transport.on('state', (s, reason) => {
      this.emit('state', s, reason)
      if (s === 'failed' || s === 'closed') {
        if (this.current === transport && !this.closed) {
          void this.demoteFrom(tier, reason)
        }
      } else if (s === 'connected') {
        this.emit('tier', tier, `connected via ${TIER_BADGE[tier].label}`)
      }
    })

    try {
      await transport.start()
    } catch (e) {
      await this.demoteFrom(tier, `start error: ${(e as Error).message}`)
    }
  }

  private buildTransport(tier: VoiceTier): VoiceTransport | null {
    switch (tier) {
      case VoiceTier.Direct:
        return new WebRtcTransport({
          remotePlayerId: this.remotePlayerId,
          polite: this.opts.polite,
          iceServers: this.opts.iceServers,
          sendSignal: (s) => this.opts.sendWebRtcSignal(s),
          connectTimeoutMs: this.opts.tier1TimeoutMs,
        })
      case VoiceTier.Mesh:
        return this.opts.meshFactory ? this.opts.meshFactory() : null
      case VoiceTier.Server:
        return new BeamMpRelayTransport(this.remotePlayerId)
    }
    return null
  }

  private async demoteFrom(tier: VoiceTier, reason?: string): Promise<void> {
    this.deadTiers.add(tier)
    if (this.opts.forceTier) {
      // Forced — don't demote.
      this.emit('state', 'failed', reason)
      return
    }
    if (tier === VoiceTier.Direct) {
      await this.tryTier(VoiceTier.Mesh)
    } else if (tier === VoiceTier.Mesh) {
      await this.tryTier(VoiceTier.Server)
    } else {
      // Tier 3 dead → nothing left.
      this.emit('state', 'failed', `all tiers exhausted (${reason ?? 'unknown'})`)
      this.currentTier = null
    }
  }
}
