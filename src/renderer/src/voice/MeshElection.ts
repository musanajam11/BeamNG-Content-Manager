/**
 * Mesh election & topology orchestration.
 *
 * Lifecycle:
 *  1. On voice enable, we probe our own NAT (NatDetector).
 *  2. We listen on a TCP port (MeshTransportHub.ensureListening).
 *  3. We broadcast a `mesh:advertise` envelope through the existing voice
 *     Lua bridge (`voiceSendSignal`) carrying our NAT profile + listen port.
 *  4. We collect peers' advertise envelopes for ~3s, then pick a supernode:
 *      - Highest cone/open count + lowest playerId tiebreak.
 *  5. For each remote peer:
 *      - If we can connect directly to their public ip:port → MeshDirect
 *      - Else if a supernode is reachable to both → MeshRelay
 *      - Else router promotes to Tier 3 (server)
 *
 * This module is a *pure* orchestrator — it builds transports and hands them
 * back to the router via `getMeshTransport(remotePlayerId)`. It does not own
 * audio fan-out.
 *
 * Mesh signaling envelope (transported as the voice signal payload after the
 * existing `playerId|...` prefix the VoiceChatService prepends):
 *
 *   { kind: 'mesh:advertise', natType, publicIp, publicPort, listenPort }
 *   { kind: 'mesh:topology',  supernodeId }
 */

import { detectNat, NatProfile } from './NatDetector'
import { MeshDirectTransport } from './transports/MeshDirectTransport'
import { MeshRelayTransport, RELAY_PREFIX, RELAY_HDR_LEN } from './transports/MeshRelayTransport'
import { MeshTransportHub } from './transports/MeshTransportHub'
import { VoiceTransport } from './transports/types'

export interface MeshAdvertise {
  kind: 'mesh:advertise'
  natType: NatProfile['type']
  publicIp: string | null
  publicPort: number | null
  listenPort: number
}

export interface MeshTopology {
  kind: 'mesh:topology'
  supernodeId: number
}

export type MeshSignalEnvelope = MeshAdvertise | MeshTopology

interface PeerMeshInfo {
  playerId: number
  advertise: MeshAdvertise
  /** When we last heard from this peer (ms epoch). */
  lastSeenAt: number
}

export interface MeshOrchestratorOpts {
  selfId: number | null
  /** Send an opaque mesh envelope through the voice signal bridge. */
  sendSignal: (envelope: MeshSignalEnvelope) => void
}

/**
 * Singleton-like orchestrator (one per voice session). The store is expected
 * to construct one in `enable()` and tear it down in `disable()`.
 */
export class MeshOrchestrator {
  private nat: NatProfile | null = null
  private listenPort: number | null = null
  private peers = new Map<number, PeerMeshInfo>()
  private supernodeId: number | null = null
  private superTransport: MeshDirectTransport | null = null
  private rebroadcastTimer: ReturnType<typeof setInterval> | null = null
  private ready = false
  private selfId: number | null
  private forwarderUnsub: (() => void) | null = null

  constructor(private opts: MeshOrchestratorOpts) {
    this.selfId = opts.selfId
    if (this.selfId !== null) {
      MeshTransportHub.get().setSelfPeerId(String(this.selfId))
    }
  }

  /** Set or update our own BeamMP player id (learned from the server). */
  setSelfId(id: number): void {
    if (this.selfId === id) return
    this.selfId = id
    MeshTransportHub.get().setSelfPeerId(String(id))
    // (Re-)advertise immediately and re-elect now that we know who we are.
    this.advertise()
    this.maybeElect()
  }

  async start(): Promise<void> {
    const hub = MeshTransportHub.get()
    try {
      const info = await hub.ensureListening()
      this.listenPort = info.port
    } catch (err) {
      console.warn('[Mesh] could not bind listener; mesh tier disabled', err)
      return
    }
    this.nat = await detectNat()
    this.ready = true
    this.advertise()
    // Re-advertise every 5s so newcomers can pick us up.
    this.rebroadcastTimer = setInterval(() => this.advertise(), 5000)
  }

  stop(): void {
    if (this.rebroadcastTimer) {
      clearInterval(this.rebroadcastTimer)
      this.rebroadcastTimer = null
    }
    if (this.forwarderUnsub) {
      this.forwarderUnsub()
      this.forwarderUnsub = null
    }
    this.superTransport?.close('mesh stopped')
    this.superTransport = null
    this.peers.clear()
    this.supernodeId = null
    this.selfId = null
    this.nat = null
    this.listenPort = null
    this.ready = false
  }

  /** Called by the store when an inbound voice signal carries mesh JSON. */
  handleSignal(fromId: number, env: MeshSignalEnvelope): void {
    if (env.kind === 'mesh:advertise') {
      this.peers.set(fromId, {
        playerId: fromId,
        advertise: env,
        lastSeenAt: Date.now(),
      })
      this.maybeElect()
    } else if (env.kind === 'mesh:topology') {
      // Validate the announced supernode: must be self, or a peer we know
      // about with a relayable NAT. Otherwise ignore (avoid being directed
      // to a black-hole id).
      const announced = env.supernodeId
      if (announced === this.selfId) {
        // Peer thinks we're the supernode; honour it (re-election is idempotent).
        this.maybeElect()
        return
      }
      const adv = this.peers.get(announced)?.advertise
      if (!adv) return
      if (adv.natType !== 'open' && adv.natType !== 'cone') return
      if (announced !== this.supernodeId) {
        this.applySupernode(announced)
      }
    }
  }

  /** Build (or return null) a mesh transport for a given remote peer. */
  getMeshTransport(remotePlayerId: number): VoiceTransport | null {
    if (!this.ready) return null
    if (this.selfId === null) return null
    const peerInfo = this.peers.get(remotePlayerId)
    if (!peerInfo) return null

    const remoteAdv = peerInfo.advertise
    const remoteCanDirect = remoteAdv.natType === 'open' || remoteAdv.natType === 'cone'

    // Direct attempt: only if remote has a usable public ip:port.
    if (remoteAdv.publicIp && remoteAdv.publicPort && remoteCanDirect) {
      // Tie-break who initiates: lower playerId is the initiator.
      const role: 'initiator' | 'acceptor' =
        this.selfId < remotePlayerId ? 'initiator' : 'acceptor'
      return new MeshDirectTransport({
        peerId: String(remotePlayerId),
        remotePlayerId,
        role,
        remote:
          role === 'initiator'
            ? { host: remoteAdv.publicIp, port: remoteAdv.publicPort }
            : undefined,
      })
    }

    // Relay attempt: need a supernode that is neither us nor the target.
    if (
      this.supernodeId !== null &&
      this.supernodeId !== this.selfId &&
      this.supernodeId !== remotePlayerId
    ) {
      void this.ensureSupernodeConnection()
      return new MeshRelayTransport({
        dstPeerId: String(remotePlayerId),
        supernodePeerId: `super:${this.supernodeId}`,
        selfId: this.selfId,
        dstId: remotePlayerId,
      })
    }

    return null
  }

  // ── private ──

  private advertise(): void {
    if (!this.ready || this.listenPort === null) return
    if (this.selfId === null) return
    const adv: MeshAdvertise = {
      kind: 'mesh:advertise',
      natType: this.nat?.type ?? 'unknown',
      publicIp: this.nat?.publicIp ?? null,
      publicPort: this.nat?.publicPort ?? null,
      listenPort: this.listenPort,
    }
    this.opts.sendSignal(adv)
  }

  private maybeElect(): void {
    if (this.selfId === null) return
    // Pick supernode = lowest playerId among (self ∪ peers) with cone/open NAT.
    type Cand = { id: number; type: NatProfile['type'] }
    const candidates: Cand[] = []
    if (this.nat?.canRelay) candidates.push({ id: this.selfId, type: this.nat.type })
    for (const p of this.peers.values()) {
      if (p.advertise.natType === 'open' || p.advertise.natType === 'cone') {
        candidates.push({ id: p.playerId, type: p.advertise.natType })
      }
    }
    if (candidates.length === 0) {
      this.applySupernode(null)
      return
    }
    candidates.sort((a, b) => {
      // Prefer 'open' over 'cone'.
      const w = (t: NatProfile['type']): number => (t === 'open' ? 0 : 1)
      return w(a.type) - w(b.type) || a.id - b.id
    })
    const chosen = candidates[0].id
    if (chosen !== this.supernodeId) {
      this.applySupernode(chosen)
      // Inform peers (not strictly necessary; each elects locally).
      this.opts.sendSignal({ kind: 'mesh:topology', supernodeId: chosen })
    }
  }

  /** Apply a new supernode: install/remove forwarding, eagerly connect. */
  private applySupernode(newId: number | null): void {
    this.supernodeId = newId

    // Tear down any previous forwarder.
    if (this.forwarderUnsub) {
      this.forwarderUnsub()
      this.forwarderUnsub = null
    }
    // Tear down any stale supernode TCP socket if the choice has changed.
    if (this.superTransport) {
      this.superTransport.close('supernode changed')
      this.superTransport = null
    }

    if (newId === null || this.selfId === null) return

    if (newId === this.selfId) {
      // We are the supernode — install global forwarding.
      this.forwarderUnsub = MeshTransportHub.get().onAnyData((_peerId, data) => {
        if (data.length < RELAY_HDR_LEN) return
        if (data[0] !== RELAY_PREFIX) return
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        const dstId = view.getUint32(7, true)
        // Don't forward to ourselves; that's already handled by MeshRelayTransport.
        if (dstId === this.selfId) return
        // Best-effort forward; sendRaw resolves false if the dst socket is
        // not open (which is normal during handshake windows).
        void MeshTransportHub.get()
          .sendRaw(String(dstId), data)
          .then((ok) => {
            if (!ok) {
              // Throttled warn: only log if we don't yet have a connection.
              // (Hub has no connection-state inspector; rely on first-fail signal.)
              console.warn('[Mesh] supernode forward dropped: no socket to', dstId)
            }
          })
      })
      console.log('[Mesh] elected as supernode — forwarding active')
    } else {
      // We must reach the supernode so we can both send relay frames AND
      // receive frames it forwards to us.
      void this.ensureSupernodeConnection()
    }
  }

  private async ensureSupernodeConnection(): Promise<void> {
    if (this.supernodeId === null) return
    if (this.selfId === null) return
    if (this.supernodeId === this.selfId) return
    if (this.superTransport) return
    const supernode = this.peers.get(this.supernodeId)
    if (!supernode) return
    const adv = supernode.advertise
    if (!adv.publicIp || !adv.publicPort) return
    const role: 'initiator' | 'acceptor' =
      this.selfId < this.supernodeId ? 'initiator' : 'acceptor'
    const targetSupernodeId = this.supernodeId
    const transport = new MeshDirectTransport({
      peerId: `super:${targetSupernodeId}`,
      remotePlayerId: targetSupernodeId,
      role,
      remote:
        role === 'initiator' ? { host: adv.publicIp, port: adv.publicPort } : undefined,
    })
    this.superTransport = transport
    // If the supernode link dies, drop our memory of it and re-elect so a
    // fresh candidate can be promoted (otherwise we'd silently lose relay).
    transport.on('state', (s) => {
      if (s !== 'failed' && s !== 'closed') return
      if (this.superTransport !== transport) return
      this.superTransport = null
      // Mark the dead supernode peer as untrusted by removing it from peers,
      // so maybeElect() picks a different candidate.
      if (this.supernodeId === targetSupernodeId) {
        this.peers.delete(targetSupernodeId)
        this.supernodeId = null
        this.maybeElect()
      }
    })
    try {
      await transport.start()
    } catch (err) {
      console.warn('[Mesh] supernode connect failed', err)
      transport.close('supernode connect failed')
      if (this.superTransport === transport) this.superTransport = null
    }
  }
}
