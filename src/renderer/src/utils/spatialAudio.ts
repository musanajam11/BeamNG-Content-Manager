/**
 * Spatial audio engine for proximity voice chat.
 * Creates and manages per-peer 3D audio chains using Web Audio API.
 *
 * Audio chain per peer:
 *   MediaStreamSource → GainNode (volume/mute/muffling) → PannerNode (3D) → destination
 */

export interface SpatialPeerAudio {
  sourceNode: MediaStreamAudioSourceNode
  gainNode: GainNode
  pannerNode: PannerNode
  analyser: AnalyserNode
  muffleGain: number // current muffle factor (1 = clear, 0.35 = muffled)
}

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
 * Create a spatial audio chain for a remote peer's audio stream.
 */
export function createPeerAudio(
  stream: MediaStream,
  proximityRange: number
): SpatialPeerAudio {
  const ctx = getAudioContext()

  const sourceNode = ctx.createMediaStreamSource(stream)
  const gainNode = ctx.createGain()
  const pannerNode = ctx.createPanner()
  const analyser = ctx.createAnalyser()

  // Configure panner for HRTF spatial audio
  pannerNode.panningModel = 'HRTF'
  pannerNode.distanceModel = 'inverse'
  pannerNode.refDistance = 2
  pannerNode.maxDistance = proximityRange
  pannerNode.rolloffFactor = 2
  pannerNode.coneInnerAngle = 360
  pannerNode.coneOuterAngle = 360
  pannerNode.coneOuterGain = 1

  // Analyser for voice activity detection
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.8

  // Chain: source → gain → panner → destination
  //        source → analyser (tapped for VAD)
  sourceNode.connect(gainNode)
  gainNode.connect(pannerNode)
  pannerNode.connect(ctx.destination)
  sourceNode.connect(analyser)

  return { sourceNode, gainNode, pannerNode, analyser, muffleGain: 1 }
}

/**
 * Destroy a peer's spatial audio chain.
 */
export function destroyPeerAudio(peer: SpatialPeerAudio): void {
  try { peer.sourceNode.disconnect() } catch { /* ignore */ }
  try { peer.gainNode.disconnect() } catch { /* ignore */ }
  try { peer.pannerNode.disconnect() } catch { /* ignore */ }
  try { peer.analyser.disconnect() } catch { /* ignore */ }
}

/**
 * Update the 3D position of a peer's audio source.
 */
export function updatePeerPosition(
  peer: SpatialPeerAudio,
  x: number,
  y: number,
  z: number
): void {
  peer.pannerNode.positionX.value = x
  peer.pannerNode.positionY.value = y
  peer.pannerNode.positionZ.value = z
}

/**
 * Update the listener (local player) position and orientation.
 */
export function updateListenerPosition(
  x: number,
  y: number,
  z: number,
  forwardX: number,
  forwardY: number,
  forwardZ: number
): void {
  const ctx = getAudioContext()
  const listener = ctx.listener

  if (listener.positionX) {
    listener.positionX.value = x
    listener.positionY.value = y
    listener.positionZ.value = z
    listener.forwardX.value = forwardX
    listener.forwardY.value = forwardY
    listener.forwardZ.value = forwardZ
    listener.upX.value = 0
    listener.upY.value = 0
    listener.upZ.value = 1
  } else {
    listener.setPosition(x, y, z)
    listener.setOrientation(forwardX, forwardY, forwardZ, 0, 0, 1)
  }
}

/**
 * Set the volume for a peer (combines output volume, distance, and muffle).
 */
export function setPeerVolume(
  peer: SpatialPeerAudio,
  outputVolume: number,
  muffleFactor: number
): void {
  peer.muffleGain = muffleFactor
  peer.gainNode.gain.value = outputVolume * muffleFactor
}

/**
 * Detect if a peer is currently speaking based on audio level.
 */
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
