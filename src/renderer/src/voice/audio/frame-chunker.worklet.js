/**
 * AudioWorklet: chunks incoming microphone PCM (typically 128-sample
 * blocks) into fixed-size frames matching VOICE_CODEC.samplesPerFrame
 * (2880 = 60 ms @ 48 kHz mono) and posts each frame to the main thread.
 *
 * Loaded via `audioWorklet.addModule(url)` — keep this file dependency-
 * free so it can be served as a static module.
 */

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
    // Mix down to mono if stereo (simple average).
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
          this._buffer[this._writeIndex + i] =
            (channel0[inIdx + i] + channel1[inIdx + i]) * 0.5
        }
      } else {
        for (let i = 0; i < copyLen; i++) {
          this._buffer[this._writeIndex + i] = channel0[inIdx + i]
        }
      }
      this._writeIndex += copyLen
      inIdx += copyLen
      if (this._writeIndex >= this._frameSize) {
        // Post a copy so we can reuse the buffer immediately.
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
