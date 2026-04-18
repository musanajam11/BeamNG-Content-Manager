/**
 * NAT behavior detection for the mesh tier.
 *
 * Goal: figure out, for the local machine, whether two remote CMs in the same
 * session can plausibly talk to us directly (we are a candidate for being a
 * mesh supernode) and what address other peers should try first.
 *
 * We deliberately implement a *cheap* probe instead of full RFC 5780:
 *   - Open an RTCPeerConnection with STUN servers
 *   - Gather ICE candidates briefly
 *   - Look at the srflx (server-reflexive) candidates that come back
 *   - Compare the public IPs reported across multiple STUN servers
 *
 * If all STUN servers report the same `ip:port`, the local NAT is
 * "endpoint-independent" enough that other peers reaching the same `ip:port`
 * will likely succeed (Cone-NAT-like).
 *
 * If the ports differ across STUN servers, we are behind a "symmetric NAT"
 * and direct CM↔CM connectivity will not work — we should never advertise
 * ourselves as a supernode.
 */

export type NatType = 'open' | 'cone' | 'symmetric' | 'unknown'

export interface NatProfile {
  type: NatType
  publicIp: string | null
  publicPort: number | null
  /** True if this peer can act as a relay (cone or open). */
  canRelay: boolean
}

const STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun.cloudflare.com:3478',
]

interface SrflxCandidate {
  ip: string
  port: number
  related: string | null
}

function parseSrflx(candidate: string): SrflxCandidate | null {
  // candidate:842163049 1 udp 1677729535 203.0.113.5 49152 typ srflx raddr 192.168.1.5 rport 49152
  const parts = candidate.split(' ')
  if (parts.length < 8) return null
  if (parts[7] !== 'srflx') return null
  const ip = parts[4]
  const port = Number(parts[5])
  const raddrIdx = parts.indexOf('raddr')
  const related = raddrIdx >= 0 ? parts[raddrIdx + 1] : null
  if (!ip || !port) return null
  return { ip, port, related }
}

/**
 * Probe NAT behavior. Resolves after `timeoutMs` (default 2s) regardless of
 * how many candidates have been gathered.
 */
export async function detectNat(timeoutMs = 2000): Promise<NatProfile> {
  const samples: SrflxCandidate[] = []
  let pc: RTCPeerConnection | null = null

  try {
    pc = new RTCPeerConnection({
      iceServers: STUN_URLS.map((u) => ({ urls: u })),
    })
    pc.createDataChannel('nat-probe')

    const done = new Promise<void>((resolve) => {
      const onCandidate = (e: RTCPeerConnectionIceEvent): void => {
        if (!e.candidate || !e.candidate.candidate) return
        const c = parseSrflx(e.candidate.candidate)
        if (c) samples.push(c)
      }
      pc!.addEventListener('icecandidate', onCandidate)
      pc!.addEventListener('icegatheringstatechange', () => {
        if (pc?.iceGatheringState === 'complete') resolve()
      })
      setTimeout(() => resolve(), timeoutMs)
    })

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await done

    if (samples.length === 0) {
      return { type: 'unknown', publicIp: null, publicPort: null, canRelay: false }
    }

    // All srflx candidates with the same IP — pick the most common.
    const ips = new Map<string, number>()
    for (const s of samples) ips.set(s.ip, (ips.get(s.ip) ?? 0) + 1)
    const publicIp = [...ips.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const sameIp = samples.filter((s) => s.ip === publicIp)

    // Distinct ports across STUN servers means symmetric NAT.
    const ports = new Set(sameIp.map((s) => s.port))

    // If raddr matches public IP, we're directly connected (no NAT).
    const noNat = sameIp.every((s) => s.related && s.related === s.ip)

    if (noNat) {
      return { type: 'open', publicIp, publicPort: sameIp[0].port, canRelay: true }
    }
    if (ports.size === 1) {
      return { type: 'cone', publicIp, publicPort: sameIp[0].port, canRelay: true }
    }
    return { type: 'symmetric', publicIp, publicPort: null, canRelay: false }
  } catch (err) {
    console.warn('[NatDetector] probe failed', err)
    return { type: 'unknown', publicIp: null, publicPort: null, canRelay: false }
  } finally {
    pc?.close()
  }
}
