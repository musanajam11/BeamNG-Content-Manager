/**
 * Proximity audio engine for voice chat.
 *
 * Simple distance-attenuated playback (no HRTF, no muffling). Each peer has:
 *   MediaStreamSource → GainNode (volume × distance falloff) → ctx.destination
 *
 * Distance falloff: 1.0 at <= refDistance (2 m), linear taper to 0.0 at
 * proximityRange. Beyond proximityRange the peer is muted.
 */

const REF_DISTANCE = 2

export interface SpatialPeerAudio {
  sourceNode: MediaStreamAudioSourceNode
  gainNode: GainNode
  analyser: AnalyserNode
  /** Latest cached listener→peer distance (m). Updated via updatePeerPosition. */
  distance: number
  /** Last absolute peer position (m). */
  px: number
  py: number
  pz: number
}

/** Latest listener position cached so updatePeerPosition can recompute distance. */
let listenerX = 0
let listenerY = 0
let listenerZ = 0

let audioCtx: AudioContext | null = null

export function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext()
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  return audioCtx
}

export function closeAudioContext(): void {
  if (audioCtx && audioCtx.state !== 'closed') {
    audioCtx.close()
    audioCtx = null
  }
}

/**
 * Route all spatial audio output to a specific device.
 * Uses AudioContext.setSinkId() (Chromium 110+).
 * Pass empty string or null for system default.
 */
export async function setOutputDevice(deviceId: string | null): Promise<void> {
  const ctx = getAudioContext() as AudioContext & { setSinkId?: (id: string) => Promise<void> }
  if (typeof ctx.setSinkId === 'function') {
    await ctx.setSinkId(deviceId ?? '')
  }
}

/**
 * Create a proximity audio chain for a remote peer's audio stream.
 * The peer plays at full volume by default; call updatePeerPosition +
 * setPeerVolume to apply distance-based attenuation.
 */
export function createPeerAudio(
  stream: MediaStream,
  proximityRange: number
): SpatialPeerAudio {
  const ctx = getAudioContext()

  const sourceNode = ctx.createMediaStreamSource(stream)
  const gainNode = ctx.createGain()
  const analyser = ctx.createAnalyser()

  // Default to full volume so audio is audible even before any telemetry
  // arrives (telemetry from BeamNG isn't always wired up).
  gainNode.gain.value = 1.0

  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.8

  // Chain: source → gain → destination ; source → analyser (tap for VAD)
  sourceNode.connect(gainNode)
  gainNode.connect(ctx.destination)
  sourceNode.connect(analyser)

  void proximityRange // accepted for API compat; consumed in setPeerVolume
  return {
    sourceNode,
    gainNode,
    analyser,
    distance: 0,
    px: 0,
    py: 0,
    pz: 0,
  }
}

/** Destroy a peer's audio chain. */
export function destroyPeerAudio(peer: SpatialPeerAudio): void {
  try { peer.sourceNode.disconnect() } catch { /* ignore */ }
  try { peer.gainNode.disconnect() } catch { /* ignore */ }
  try { peer.analyser.disconnect() } catch { /* ignore */ }
}

/** Cache peer's world position; recomputes distance against listener. */
export function updatePeerPosition(
  peer: SpatialPeerAudio,
  x: number,
  y: number,
  z: number
): void {
  peer.px = x
  peer.py = y
  peer.pz = z
  const dx = x - listenerX
  const dy = y - listenerY
  const dz = z - listenerZ
  peer.distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Update the listener (local player) position. Orientation is ignored. */
export function updateListenerPosition(
  x: number,
  y: number,
  z: number,
  _forwardX: number,
  _forwardY: number,
  _forwardZ: number
): void {
  listenerX = x
  listenerY = y
  listenerZ = z
}

/**
 * Compute distance falloff factor: 1.0 at <= refDistance, linear taper to
 * 0.0 at proximityRange, 0 beyond. Returns 1 if distance is unknown (0).
 */
function distanceAttenuation(distance: number, proximityRange: number): number {
  if (distance <= REF_DISTANCE) return 1
  if (distance >= proximityRange) return 0
  const t = (distance - REF_DISTANCE) / Math.max(1, proximityRange - REF_DISTANCE)
  return Math.max(0, 1 - t)
}

/**
 * Set effective playback volume for a peer:
 *   gain = outputVolume × distanceAttenuation(distance, proximityRange)
 * Pass `outputVolume = 0` to mute the peer regardless of distance.
 */
export function setPeerVolume(
  peer: SpatialPeerAudio,
  outputVolume: number,
  proximityRange: number
): void {
  const atten = distanceAttenuation(peer.distance, proximityRange)
  peer.gainNode.gain.value = outputVolume * atten
}

/** Detect if a peer is currently speaking based on audio level. */
export function isPeerSpeaking(peer: SpatialPeerAudio, threshold: number): boolean {
  const data = new Uint8Array(peer.analyser.frequencyBinCount)
  peer.analyser.getByteFrequencyData(data)
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    sum += data[i]
  }
  const avg = sum / data.length / 255
  return avg > threshold
}
