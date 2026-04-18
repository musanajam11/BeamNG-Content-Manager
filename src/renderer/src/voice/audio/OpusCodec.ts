/**
 * Opus encoder/decoder using the WebCodecs API (native in Chromium 94+).
 *
 * Electron 39 bundles Chromium 130+, so AudioEncoder / AudioDecoder with
 * the 'opus' codec are guaranteed to be available — no WASM bundle needed.
 *
 * Frame size and bitrate are fixed by VOICE_CODEC so all tiers speak the
 * same wire format end-to-end (no transcoding ever).
 */

import { OpusFrame, VOICE_CODEC } from '../transports/types'

/** Result of probing browser support. */
export interface OpusSupport {
  encoder: boolean
  decoder: boolean
  reason?: string
}

/**
 * Check whether WebCodecs Opus encode/decode is available in this runtime.
 * Resolves quickly; safe to call before any other voice work.
 */
export async function probeOpusSupport(): Promise<OpusSupport> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined') {
    return { encoder: false, decoder: false, reason: 'WebCodecs unavailable' }
  }
  try {
    const config: AudioEncoderConfig = {
      codec: 'opus',
      sampleRate: VOICE_CODEC.sampleRate,
      numberOfChannels: VOICE_CODEC.channels,
      bitrate: VOICE_CODEC.bitrate,
    }
    const encOk = await AudioEncoder.isConfigSupported(config)
    const decOk = await AudioDecoder.isConfigSupported({
      codec: 'opus',
      sampleRate: VOICE_CODEC.sampleRate,
      numberOfChannels: VOICE_CODEC.channels,
    })
    return {
      encoder: !!encOk.supported,
      decoder: !!decOk.supported,
      reason: encOk.supported && decOk.supported ? undefined : 'Opus not supported',
    }
  } catch (e) {
    return { encoder: false, decoder: false, reason: (e as Error).message }
  }
}

export interface OpusEncoderEvents {
  frame: (frame: OpusFrame) => void
  error: (err: Error) => void
}

/**
 * Streaming Opus encoder. Feed it 48 kHz mono Float32 PCM in 60 ms chunks
 * (2880 samples) and it emits OpusFrames via the `frame` event.
 */
export class OpusFrameEncoder {
  private encoder: AudioEncoder | null = null
  private seq = 0
  private nextTimestampUs = 0
  private listeners: Partial<OpusEncoderEvents> = {}
  private closed = false

  on<K extends keyof OpusEncoderEvents>(ev: K, h: OpusEncoderEvents[K]): void {
    this.listeners[ev] = h
  }

  async start(): Promise<void> {
    if (this.encoder) return
    this.encoder = new AudioEncoder({
      output: (chunk: EncodedAudioChunk) => {
        const buf = new Uint8Array(chunk.byteLength)
        chunk.copyTo(buf)
        this.listeners.frame?.({
          data: buf,
          seq: this.seq,
          timestampUs: chunk.timestamp,
        })
        this.seq = (this.seq + 1) & 0xffff
      },
      error: (e: Error) => this.listeners.error?.(e),
    })
    this.encoder.configure({
      codec: 'opus',
      sampleRate: VOICE_CODEC.sampleRate,
      numberOfChannels: VOICE_CODEC.channels,
      bitrate: VOICE_CODEC.bitrate,
    })
  }

  /** Encode one 60 ms PCM frame (2880 mono Float32 samples). */
  encode(pcm: Float32Array): void {
    if (this.closed || !this.encoder) return
    if (pcm.length !== VOICE_CODEC.samplesPerFrame) {
      this.listeners.error?.(
        new Error(`expected ${VOICE_CODEC.samplesPerFrame} samples, got ${pcm.length}`),
      )
      return
    }
    // Copy into an ArrayBuffer-backed Float32Array so AudioData's BufferSource
    // type accepts it under TS strict lib (rejects SharedArrayBuffer-backed views).
    const safe = new Float32Array(new ArrayBuffer(pcm.byteLength))
    safe.set(pcm)
    const audioData = new AudioData({
      format: 'f32',
      sampleRate: VOICE_CODEC.sampleRate,
      numberOfChannels: VOICE_CODEC.channels,
      numberOfFrames: pcm.length,
      timestamp: this.nextTimestampUs,
      data: safe,
    })
    this.nextTimestampUs += VOICE_CODEC.frameMs * 1000
    try {
      this.encoder.encode(audioData)
    } finally {
      audioData.close()
    }
  }

  async flush(): Promise<void> {
    await this.encoder?.flush()
  }

  close(): void {
    this.closed = true
    try {
      this.encoder?.close()
    } catch {
      /* ignore */
    }
    this.encoder = null
  }
}

export interface OpusDecoderEvents {
  pcm: (pcm: Float32Array, timestampUs: number) => void
  error: (err: Error) => void
}

/**
 * Streaming Opus decoder. Feed it OpusFrames; emits 48 kHz mono Float32
 * PCM via the `pcm` event. Caller is responsible for jitter buffering /
 * scheduling — this just decodes.
 */
export class OpusFrameDecoder {
  private decoder: AudioDecoder | null = null
  private listeners: Partial<OpusDecoderEvents> = {}
  private closed = false

  on<K extends keyof OpusDecoderEvents>(ev: K, h: OpusDecoderEvents[K]): void {
    this.listeners[ev] = h
  }

  async start(): Promise<void> {
    if (this.decoder) return
    this.decoder = new AudioDecoder({
      output: (data: AudioData) => {
        try {
          const numFrames = data.numberOfFrames
          const pcm = new Float32Array(numFrames)
          data.copyTo(pcm, { planeIndex: 0, format: 'f32' })
          this.listeners.pcm?.(pcm, data.timestamp)
        } finally {
          data.close()
        }
      },
      error: (e: Error) => this.listeners.error?.(e),
    })
    this.decoder.configure({
      codec: 'opus',
      sampleRate: VOICE_CODEC.sampleRate,
      numberOfChannels: VOICE_CODEC.channels,
    })
  }

  decode(frame: OpusFrame): void {
    if (this.closed || !this.decoder) return
    const chunk = new EncodedAudioChunk({
      type: 'key',
      timestamp: frame.timestampUs,
      duration: VOICE_CODEC.frameMs * 1000,
      data: frame.data,
    })
    try {
      this.decoder.decode(chunk)
    } catch (e) {
      this.listeners.error?.(e as Error)
    }
  }

  close(): void {
    this.closed = true
    try {
      this.decoder?.close()
    } catch {
      /* ignore */
    }
    this.decoder = null
  }
}
