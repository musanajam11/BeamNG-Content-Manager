/**
 * Self-loopback dev utility — encodes microphone audio with the new
 * AudioCapture → OpusCodec → JitterBuffer pipeline and routes it back
 * through the speakers. Used for the Phase 1 exit-criteria test:
 *
 *   "Self-loopback works: encode → decode → play your own voice"
 *
 * Exposed on `window.__voiceLoopback` in dev mode (see main.tsx wiring).
 *
 * Usage from devtools console:
 *   const stop = await window.__voiceLoopback.start()
 *   // speak; you should hear yourself with ~180 ms of jitter-buffer delay
 *   stop()
 */

import { AudioCapture } from './audio/AudioCapture'
import { JitterBuffer } from './audio/JitterBuffer'
import { probeOpusSupport } from './audio/OpusCodec'
import { getAudioContext } from '../utils/spatialAudio'

export interface LoopbackHandle {
  stop: () => Promise<void>
  getStats: () => { sent: number; received: number; jitter: ReturnType<JitterBuffer['getStats']> }
}

export async function startVoiceLoopback(): Promise<LoopbackHandle> {
  const support = await probeOpusSupport()
  if (!support.encoder || !support.decoder) {
    throw new Error(`Opus unavailable: ${support.reason ?? 'unknown'}`)
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      sampleRate: 48_000,
      channelCount: 1,
    },
  })

  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()

  const jitter = new JitterBuffer({ audioContext: ctx })
  await jitter.start()

  const capture = new AudioCapture({ stream })
  let sent = 0
  let received = 0

  capture.on('frame', (f) => {
    sent++
    // No transport — feed straight into the local jitter buffer.
    received++
    jitter.push(f)
  })
  capture.on('error', (e) => console.error('[loopback] capture error', e))

  await capture.start()

  // Route the jitter buffer's MediaStream through a simple gain → output.
  const src = ctx.createMediaStreamSource(jitter.outputStream)
  const gain = ctx.createGain()
  gain.gain.value = 1.0
  src.connect(gain).connect(ctx.destination)

  return {
    async stop(): Promise<void> {
      try {
        src.disconnect()
        gain.disconnect()
      } catch {
        /* ignore */
      }
      await capture.stop()
      jitter.close()
      stream.getTracks().forEach((t) => t.stop())
    },
    getStats(): { sent: number; received: number; jitter: ReturnType<JitterBuffer['getStats']> } {
      return { sent, received, jitter: jitter.getStats() }
    },
  }
}
