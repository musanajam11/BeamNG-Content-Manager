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

// Vite serves the worklet file as a static URL. The `?url` suffix is the
// Vite-supported way to import an asset path; electron-vite (web project)
// inherits this behaviour.
import frameChunkerUrl from './frame-chunker.worklet.js?url'

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

    await this.ctx.audioWorklet.addModule(frameChunkerUrl)

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
      this.encoder.encode(ev.data)
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
