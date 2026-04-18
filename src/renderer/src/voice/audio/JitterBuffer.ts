/**
 * JitterBuffer + scheduled playback.
 *
 * Receives OpusFrames from any VoiceTransport, decodes them, and plays
 * the PCM through a GainNode (`outputNode`) so the existing spatial audio
 * chain (`createPeerAudio` in `utils/spatialAudio.ts`) can connect to it
 * directly without going through a MediaStream round-trip (which adds
 * latency and an extra buffering / resampling stage prone to dropouts).
 *
 * Design:
 * - Decode is eager (decoder is fast; latency comes from playback queue).
 * - Decoded PCM is keyed by seq into a small ring window so out-of-order
 *   arrivals can be reordered.
 * - A `tick` runs every frameMs and dequeues the next-expected seq. If
 *   missing and the slot deadline has passed, silence is inserted (PLC
 *   substitute) and the seq is advanced.
 * - Initial fill: wait until `targetDepth` frames buffered before first
 *   playout.
 */

import { OpusFrameDecoder } from './OpusCodec'
import { OpusFrame, VOICE_CODEC } from '../transports/types'

export interface JitterBufferOptions {
  /** AudioContext to schedule playback in. Pass the spatial-audio shared one. */
  audioContext: AudioContext
  /** How many frames to buffer before starting playout (default 3 → 180 ms). */
  targetDepth?: number
  /** Hard cap on buffered frames; oldest dropped above this (default 10). */
  maxDepth?: number
}

/** Modular distance between two 16-bit sequence numbers (a → b). */
function seqDelta(a: number, b: number): number {
  let d = (b - a) & 0xffff
  if (d > 0x7fff) d -= 0x10000
  return d
}

export class JitterBuffer {
  /** Output node — connect this to a GainNode / destination chain. */
  readonly outputNode: GainNode
  private readonly ctx: AudioContext
  private readonly decoder: OpusFrameDecoder
  private readonly targetDepth: number
  private readonly maxDepth: number

  /** seq → decoded PCM (Float32Array of samplesPerFrame). */
  private buffer = new Map<number, Float32Array>()
  /** Seq we expect to play next. Set on first decoded frame. */
  private nextSeq: number | null = null
  /** AudioContext.currentTime at which the next frame should start. */
  private nextStartTime = 0
  /** Whether the warm-up phase (fill to targetDepth) has finished. */
  private playing = false
  /** Periodic tick handle. */
  private tickHandle: ReturnType<typeof setInterval> | null = null
  private closed = false
  private framesPlayed = 0
  private framesDropped = 0
  private framesLost = 0

  constructor(opts: JitterBufferOptions) {
    this.ctx = opts.audioContext
    this.targetDepth = opts.targetDepth ?? 3
    this.maxDepth = opts.maxDepth ?? 10
    // Unity-gain node — the spatial audio chain attaches here. Using a
    // GainNode (vs raw destination) gives us a stable connect target even
    // before any BufferSource has been scheduled.
    this.outputNode = this.ctx.createGain()
    this.outputNode.gain.value = 1.0
    this.decoder = new OpusFrameDecoder()
  }

  async start(): Promise<void> {
    await this.decoder.start()
    this.decoder.on('pcm', (pcm, _ts) => this.onDecoded(pcm))
    this.decoder.on('error', (e) => console.warn('[JitterBuffer] decode error', e))
    // Tick at frame cadence to drain the buffer.
    this.tickHandle = setInterval(() => this.tick(), VOICE_CODEC.frameMs)
  }

  /** Push an inbound OpusFrame from the transport. */
  push(frame: OpusFrame): void {
    if (this.closed) return
    // Drop frames already in the past.
    if (this.nextSeq !== null && seqDelta(this.nextSeq, frame.seq) < 0) {
      this.framesDropped++
      return
    }
    // WebCodecs AudioDecoder is async but preserves input/output order for
    // Opus. Queue this seq so onDecoded can pull the matching one when the
    // PCM eventually arrives. Previously we used a single shared
    // `pendingSeq` field which was overwritten by every push() before the
    // prior decode finished — almost every frame ended up stamped with the
    // wrong seq, producing the "broken / unusable audio" symptom.
    //
    // Cap the queue so a stalled decoder (e.g. tab backgrounded long
    // enough to throttle the worker) can't grow unboundedly and leak
    // memory over a long session. If we overflow, drop the oldest pending
    // seq — the corresponding PCM (whenever it arrives) will be
    // recognised as past-due and discarded by onDecoded.
    if (this.pendingSeqs.length > this.maxDepth * 4) {
      this.pendingSeqs.shift()
      this.framesDropped++
    }
    this.pendingSeqs.push(frame.seq)
    this.decoder.decode(frame)
  }

  private pendingSeqs: number[] = []

  private onDecoded(pcm: Float32Array): void {
    const seq = this.pendingSeqs.shift()
    if (seq === undefined) return
    if (this.nextSeq === null) this.nextSeq = seq
    // If the decoded frame is already in the past, drop it.
    if (seqDelta(this.nextSeq, seq) < 0) {
      this.framesDropped++
      return
    }
    this.buffer.set(seq, pcm)
    // Trim if over capacity.
    if (this.buffer.size > this.maxDepth) {
      // Drop the oldest by seq distance to nextSeq.
      let oldest = seq
      let oldestDelta = 0
      for (const k of this.buffer.keys()) {
        const d = seqDelta(this.nextSeq, k)
        if (d < oldestDelta) {
          oldestDelta = d
          oldest = k
        }
      }
      this.buffer.delete(oldest)
      this.framesDropped++
    }
  }

  private tick(): void {
    if (this.closed || this.nextSeq === null) return
    if (!this.playing) {
      if (this.buffer.size < this.targetDepth) return
      this.playing = true
      this.nextStartTime = this.ctx.currentTime + 0.02 // tiny lead
    }

    // Schedule frames until our next-start cursor is at least
    // (targetDepth * frameMs) ahead of real time. This keeps the audio
    // graph fed even if setInterval(frameMs) drifts to 70-100 ms under
    // load, which would otherwise starve the queue and cause dropouts.
    // Cap at a sane upper bound per tick so a long pause doesn't try to
    // catch up by scheduling hundreds of frames.
    const frameSec = VOICE_CODEC.frameMs / 1000
    const targetLeadSec = this.targetDepth * frameSec
    let scheduled = 0
    const maxPerTick = this.maxDepth + 2
    while (
      scheduled < maxPerTick &&
      this.nextStartTime - this.ctx.currentTime < targetLeadSec
    ) {
      const seq = this.nextSeq
      let pcm = this.buffer.get(seq)
      if (pcm) {
        this.buffer.delete(seq)
      } else {
        // No PCM yet for this seq. If we still have plenty of audio
        // already queued in the future, prefer to wait one tick rather
        // than emitting silence — a late-arriving frame can still land
        // in time. Only emit concealment once the queue is dangerously
        // close to underrun (less than one frame of lead).
        if (this.nextStartTime - this.ctx.currentTime > frameSec) break
        pcm = new Float32Array(VOICE_CODEC.samplesPerFrame)
        this.framesLost++
      }
      this.scheduleFrame(pcm)
      this.nextSeq = (seq + 1) & 0xffff
      this.framesPlayed++
      scheduled++
    }
  }

  private scheduleFrame(pcm: Float32Array): void {
    const buf = this.ctx.createBuffer(
      VOICE_CODEC.channels,
      VOICE_CODEC.samplesPerFrame,
      VOICE_CODEC.sampleRate,
    )
    // copyToChannel under strict TS rejects ArrayBufferLike-backed views; copy
    // into a fresh ArrayBuffer-backed Float32Array first.
    const safe = new Float32Array(new ArrayBuffer(pcm.byteLength))
    safe.set(pcm)
    buf.copyToChannel(safe, 0)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.outputNode)
    // If we've fallen behind real time, jump forward to avoid pile-up.
    const now = this.ctx.currentTime
    if (this.nextStartTime < now) this.nextStartTime = now + 0.005
    src.start(this.nextStartTime)
    this.nextStartTime += VOICE_CODEC.frameMs / 1000
  }

  getStats(): {
    buffered: number
    played: number
    dropped: number
    lost: number
    playing: boolean
  } {
    return {
      buffered: this.buffer.size,
      played: this.framesPlayed,
      dropped: this.framesDropped,
      lost: this.framesLost,
      playing: this.playing,
    }
  }

  close(): void {
    this.closed = true
    if (this.tickHandle) {
      clearInterval(this.tickHandle)
      this.tickHandle = null
    }
    this.buffer.clear()
    this.decoder.close()
    try {
      this.outputNode.disconnect()
    } catch {
      /* ignore */
    }
  }
}
