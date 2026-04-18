/**
 * Hub for the renderer side of the mesh transport.
 *
 * - Owns the singleton subscription to `onVoiceMeshData` / `onVoiceMeshState`
 *   and demuxes by peerId into per-peer transport instances.
 * - Provides a single `listen()` entry point that ensures the main-process
 *   TCP listener is up exactly once.
 *
 * Wire format on a mesh socket: each TCP frame from the main process is the
 * payload bytes of a single application-level message:
 *
 *   [seqHi(1B)][seqLo(1B)] [opus bytes...]      ← MeshDirect / MeshRelay raw frame
 *   [0xFE] [json...]                            ← control message (heartbeat, relay routing)
 *
 * The 0xFE prefix is a synchronization sentinel that cannot collide with the
 * seqHi byte of an audio frame because the renderer only emits 0xFE-prefixed
 * payloads through the control path.
 */

const CONTROL_PREFIX = 0xfe

type DataHandler = (data: Uint8Array) => void
type StateHandler = (state: 'connecting' | 'open' | 'closed' | 'error', reason?: string) => void

interface PeerSubscription {
  onData: Set<DataHandler>
  onState: Set<StateHandler>
}

class MeshTransportHub {
  private static instance: MeshTransportHub | null = null
  private peers = new Map<string, PeerSubscription>()
  private listenPromise: Promise<{ port: number }> | null = null
  private subscribed = false
  private selfPeerId: string | null = null
  /** Resolvers waiting for setSelfPeerId() so connect() can be queued. */
  private selfPeerIdWaiters = new Set<() => void>()
  /** Fires for every inbound mesh datum, regardless of peer registration. */
  private anyDataListeners = new Set<(peerId: string, data: Uint8Array) => void>()

  static get(): MeshTransportHub {
    if (!this.instance) this.instance = new MeshTransportHub()
    return this.instance
  }

  private constructor() {
    // empty — wiring happens lazily on first ensureListening()
  }

  setSelfPeerId(id: string): void {
    if (!id || id.length === 0 || id.length > 64) {
      console.warn('[MeshTransportHub] setSelfPeerId: invalid id', JSON.stringify(id))
      return
    }
    this.selfPeerId = id
    // Wake any pending connect() awaiters.
    const waiters = Array.from(this.selfPeerIdWaiters)
    this.selfPeerIdWaiters.clear()
    for (const w of waiters) w()
  }

  getSelfPeerId(): string | null {
    return this.selfPeerId
  }

  onAnyData(handler: (peerId: string, data: Uint8Array) => void): () => void {
    this.anyDataListeners.add(handler)
    return () => { this.anyDataListeners.delete(handler) }
  }

  async ensureListening(): Promise<{ port: number }> {
    if (!this.subscribed) {
      window.api.onVoiceMeshData(({ peerId, data }) => {
        for (const h of this.anyDataListeners) h(peerId, data)
        const sub = this.peers.get(peerId)
        if (!sub) return
        for (const h of sub.onData) h(data)
      })
      window.api.onVoiceMeshState(({ peerId, state, reason }) => {
        const sub = this.peers.get(peerId)
        if (!sub) return
        for (const h of sub.onState) h(state, reason)
      })
      this.subscribed = true
    }
    if (!this.listenPromise) this.listenPromise = window.api.voiceMeshListen()
    return this.listenPromise
  }

  registerPeer(peerId: string): PeerSubscription {
    let sub = this.peers.get(peerId)
    if (!sub) {
      sub = { onData: new Set(), onState: new Set() }
      this.peers.set(peerId, sub)
    }
    return sub
  }

  unregisterPeer(peerId: string): void {
    this.peers.delete(peerId)
  }

  async connect(peerId: string, host: string, port: number): Promise<{ success: boolean; error?: string }> {
    if (!this.selfPeerId) {
      // Wait briefly for setSelfPeerId() rather than failing the transport
      // permanently. Common during the first 1–2s after voice enable.
      const waited = await new Promise<boolean>((resolve) => {
        let done = false
        const wake = (): void => {
          if (done) return
          done = true
          resolve(true)
        }
        this.selfPeerIdWaiters.add(wake)
        setTimeout(() => {
          if (done) return
          this.selfPeerIdWaiters.delete(wake)
          done = true
          resolve(false)
        }, 5000)
      })
      if (!waited || !this.selfPeerId) {
        return { success: false, error: 'mesh selfPeerId not yet known' }
      }
    }
    return window.api.voiceMeshConnect({ peerId, host, port, selfPeerId: this.selfPeerId })
  }

  async disconnect(peerId: string): Promise<void> {
    await window.api.voiceMeshDisconnect(peerId)
  }

  async sendRaw(peerId: string, data: Uint8Array): Promise<boolean> {
    return window.api.voiceMeshSend({ peerId, data })
  }
}

export { MeshTransportHub, CONTROL_PREFIX }
