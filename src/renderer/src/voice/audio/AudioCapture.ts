/**
 * AudioCapture — pipeline from microphone MediaStream → 60 ms PCM frames
 * → Opus encoder → OpusFrame events.
 *
 * The capture path runs on its own AudioContext fixed at 48 kHz so the
 * downstream codec & jitter-buffer math can assume a constant sample
 * rate regardless of the device default.
 */

import { OpusFrameEncoder } from './OpusCodec'
import { OpusFrame, VOICE_CODEC } from '../transports/types'

// The AudioWorklet is inlined as a Blob URL rather than imported via
// Vite's `?url` suffix. The `?url` approach silently fails in packaged
// Electron builds because (a) Vite does not emit `.worklet.js` files as
// assets unless they're in `public/`, and (b) even when emitted, the
// resulting `file://` URL fails `audioWorklet.addModule()` with
// `AbortError: Unable to load a worklet's module.` Inlining keeps the
// processor source colocated with its only consumer and works in dev,
// production, and tests without any build configuration.
const FRAME_CHUNKER_WORKLET_SRC = `
class FrameChunkerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const frameSize = (options && options.processorOptions && options.processorOptions.frameSize) || 2880
    this._frameSize = frameSize
    this._buffer = new Float32Array(frameSize)
    this._writeIndex = 0
  }
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channel0 = input[0]
    const channel1 = input.length > 1 ? input[1] : null
    if (!channel0) return true
    const inLen = channel0.length
    let inIdx = 0
    while (inIdx < inLen) {
      const space = this._frameSize - this._writeIndex
      const copyLen = Math.min(space, inLen - inIdx)
      if (channel1) {
        for (let i = 0; i < copyLen; i++) {
          this._buffer[this._writeIndex + i] = (channel0[inIdx + i] + channel1[inIdx + i]) * 0.5
        }
      } else {
        for (let i = 0; i < copyLen; i++) {
          this._buffer[this._writeIndex + i] = channel0[inIdx + i]
        }
      }
      this._writeIndex += copyLen
      inIdx += copyLen
      if (this._writeIndex >= this._frameSize) {
        const out = new Float32Array(this._frameSize)
        out.set(this._buffer)
        this.port.postMessage(out, [out.buffer])
        this._writeIndex = 0
      }
    }
    return true
  }
}
registerProcessor('frame-chunker', FrameChunkerProcessor)
`

let frameChunkerBlobUrl: string | null = null
function getFrameChunkerUrl(): string {
  if (!frameChunkerBlobUrl) {
    const blob = new Blob([FRAME_CHUNKER_WORKLET_SRC], { type: 'application/javascript' })
    frameChunkerBlobUrl = URL.createObjectURL(blob)
  }
  return frameChunkerBlobUrl
}

export interface AudioCaptureEvents {
  frame: (frame: OpusFrame) => void
  error: (err: Error) => void
}

export interface AudioCaptureOptions {
  /** Microphone stream from `getUserMedia`. */
  stream: MediaStream
  /**
   * Optional gain applied before encoding (1.0 = unity). Lets the existing
   * input-gain UI keep working without a separate WebAudio chain.
   */
  gain?: number
  /** When true, encoder is created but `encode()` is never called → silence. */
  muted?: boolean
}

export class AudioCapture {
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private gainNode: GainNode | null = null
  private worklet: AudioWorkletNode | null = null
  private encoder: OpusFrameEncoder | null = null
  private listeners: Partial<AudioCaptureEvents> = {}
  private muted: boolean
  private gain: number
  private stream: MediaStream
  private started = false
  /** When non-null, frames below this RMS level are dropped (input-side VAD). */
  private vadThreshold: number | null = null
  /** Hold-open window (ms) after the last frame that crossed threshold. */
  private vadHangoverMs = 250
  private lastVoiceTs = 0
  /** Smoothed RMS for UI / debugging. */
  private currentLevel = 0

  constructor(opts: AudioCaptureOptions) {
    this.stream = opts.stream
    this.gain = opts.gain ?? 1.0
    this.muted = opts.muted ?? false
  }

  on<K extends keyof AudioCaptureEvents>(ev: K, h: AudioCaptureEvents[K]): void {
    this.listeners[ev] = h
  }

  setGain(g: number): void {
    this.gain = g
    if (this.gainNode) this.gainNode.gain.value = g
  }

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  /**
   * Enable input-side voice-activity gating. Pass `null` to disable (e.g.
   * when switching to PTT mode where the gate is the muted flag).
   * Threshold is compared against per-frame RMS in the same scale as
   * `isPeerSpeaking` (0.0 – 1.0 nominal).
   */
  setVadGate(threshold: number | null, hangoverMs = 250): void {
    this.vadThreshold = threshold
    this.vadHangoverMs = Math.max(0, hangoverMs)
  }

  /** Last computed input RMS (0..1). */
  getInputLevel(): number {
    return this.currentLevel
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    // Dedicated capture context locked to 48 kHz to match Opus.
    this.ctx = new AudioContext({ sampleRate: VOICE_CODEC.sampleRate, latencyHint: 'interactive' })
    if (this.ctx.sampleRate !== VOICE_CODEC.sampleRate) {
      // Browsers may ignore the requested sampleRate on some platforms.
      // We could resample with OfflineAudioContext but for now warn loudly.
      console.warn(
        `[AudioCapture] AudioContext sampleRate ${this.ctx.sampleRate} != ${VOICE_CODEC.sampleRate}; encoder may produce wrong-pitch audio`,
      )
    }

    await this.ctx.audioWorklet.addModule(getFrameChunkerUrl())

    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.gainNode = this.ctx.createGain()
    this.gainNode.gain.value = this.gain

    this.worklet = new AudioWorkletNode(this.ctx, 'frame-chunker', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { frameSize: VOICE_CODEC.samplesPerFrame },
    })

    this.encoder = new OpusFrameEncoder()
    this.encoder.on('frame', (f) => this.listeners.frame?.(f))
    this.encoder.on('error', (e) => this.listeners.error?.(e))
    await this.encoder.start()

    this.worklet.port.onmessage = (ev: MessageEvent<Float32Array>): void => {
      if (this.muted || !this.encoder) return
      const pcm = ev.data
      // Compute frame RMS for VAD gating + level meter. Cheap: ~2880 muls.
      let sumSq = 0
      for (let i = 0; i < pcm.length; i++) {
        const s = pcm[i]
        sumSq += s * s
      }
      const rms = Math.sqrt(sumSq / pcm.length)
      // Light smoothing for UI; gate uses raw RMS for snappier response.
      this.currentLevel = this.currentLevel * 0.7 + rms * 0.3
      if (this.vadThreshold !== null) {
        const now = performance.now()
        if (rms >= this.vadThreshold) {
          this.lastVoiceTs = now
        } else if (now - this.lastVoiceTs > this.vadHangoverMs) {
          // Below threshold and past hangover → silence, skip encode.
          return
        }
      }
      this.encoder.encode(pcm)
    }

    this.source.connect(this.gainNode).connect(this.worklet)
  }

  async stop(): Promise<void> {
    this.started = false
    try {
      this.worklet?.disconnect()
      this.gainNode?.disconnect()
      this.source?.disconnect()
    } catch {
      /* ignore */
    }
    this.worklet = null
    this.gainNode = null
    this.source = null
    if (this.encoder) {
      await this.encoder.flush().catch(() => undefined)
      this.encoder.close()
      this.encoder = null
    }
    if (this.ctx) {
      await this.ctx.close().catch(() => undefined)
      this.ctx = null
    }
  }
}
