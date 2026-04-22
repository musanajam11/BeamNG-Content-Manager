/**
 * Tier 4 Phase 4 — terrain heightmap snapshot helper (Node side).
 *
 * BeamNG's `TerrainBlock` exposes a 16-bit height array via
 * `getHeightMap()` / `setHeightMap(data, width)` (see
 * Docs/WORLD-EDITOR-SYNC.md §"Phase 4 — Terrain heightmap"). This
 * service is the Node-side glue that:
 *
 *   1. Encodes a flat `Uint16Array` (Lua-side capture, in row-major
 *      order, x then y) into the wire format `raw-u16-le`. The
 *      Lua side may hand us a base64 string or a typed array; this
 *      service normalises both into a `Buffer` of bytes.
 *   2. Splits a heightmap blob into chunks small enough to ride
 *      the existing `Y|` snapshot-chunk frame (same path used for
 *      Phase 2 scene snapshots — keeps wire complexity to zero).
 *   3. Computes a SHA-256 over the assembled bytes so the joiner
 *      can compare against its own on-disk `.ter` file and skip
 *      the transfer when nothing's changed (see #14 base-hash skip).
 *
 * The actual capture/apply lives in the embedded Lua in
 * `GameLauncherService.ts`; this file deliberately knows nothing
 * about TerrainBlock or `core_terrain` — only about bytes.
 *
 * Encoding rationale: Torque3D / BeamNG persists height as `u16`
 * (0..65535) representing the 0..1 fraction of `maxHeight`, which
 * is in turn baked into the level's `.ter` file. We carry the raw
 * 16-bit values so re-applying via `setHeightMap` is a memcpy on
 * the joiner side. Little-endian matches every desktop platform
 * BeamNG runs on; we don't byte-swap.
 *
 * NOT exported here: any IPC, TCP, or persistence concerns. This
 * service is pure: in → bytes → out. Callers (the relay /
 * EditorSyncSessionController) handle delivery.
 */

import { createHash } from 'crypto'

/**
 * One terrain heightmap blob, ready to ship inside a snapshot. The
 * `chunks` array is the splitting that `EditorSyncRelayService`
 * will hand back to the Lua bridge as individual `B|` frames; the
 * full heightmap is `Buffer.concat(chunks)`.
 */
export interface EncodedTerrainHeightMap {
  /** Samples per side. BeamNG terrains are square; width === height. */
  width: number
  /** Always `'raw-u16-le'` for now; reserved for future zlib variants. */
  encoding: 'raw-u16-le'
  /**
   * Total byte length across all chunks (equals `width² × 2` for a
   * raw u16 buffer). Lets the joiner pre-allocate.
   */
  totalBytes: number
  /**
   * Hex-encoded SHA-256 of the concatenated bytes. Used by the
   * `baseMatches` short-circuit (#14) — joiner compares against
   * its own on-disk `.ter` hash and skips the apply if equal.
   */
  sha256: string
  /** Raw u16-le bytes split into `<= maxChunkBytes` slices. */
  chunks: Buffer[]
}

/**
 * Default chunk cap. Matches the `~64 KB` ceiling we use for Phase 2
 * scene snapshots — each chunk fits comfortably inside a single TCP
 * write and a single `Y|` frame after JSON encoding (heightmap bytes
 * are base64'd by the bridge; 64 KB → ~88 KB ASCII, well under the
 * relay's per-frame ceiling).
 */
export const DEFAULT_TERRAIN_CHUNK_BYTES = 64 * 1024

export class TerrainSnapshotService {
  /**
   * Encode a Lua-supplied heightmap into the wire format. Accepts:
   *   - `Buffer` (already raw u16-le bytes)
   *   - `Uint16Array` (host byte order; we emit LE)
   *   - `string` (base64 of raw u16-le bytes — Lua's normal hand-off)
   *
   * Throws on a length that doesn't match `width² × 2` so a malformed
   * capture doesn't silently corrupt the joiner's terrain.
   */
  encodeHeightMap(
    raw: Buffer | Uint16Array | string,
    width: number,
    maxChunkBytes: number = DEFAULT_TERRAIN_CHUNK_BYTES,
  ): EncodedTerrainHeightMap {
    if (!Number.isInteger(width) || width <= 0) {
      throw new Error(`encodeHeightMap: invalid width ${width}`)
    }
    if (!Number.isInteger(maxChunkBytes) || maxChunkBytes <= 0) {
      throw new Error(`encodeHeightMap: invalid maxChunkBytes ${maxChunkBytes}`)
    }
    let bytes: Buffer
    if (typeof raw === 'string') {
      bytes = Buffer.from(raw, 'base64')
    } else if (raw instanceof Uint16Array) {
      // Re-emit as little-endian regardless of platform endianness.
      bytes = Buffer.alloc(raw.length * 2)
      for (let i = 0; i < raw.length; i++) bytes.writeUInt16LE(raw[i] ?? 0, i * 2)
    } else {
      bytes = raw
    }
    const expected = width * width * 2
    if (bytes.length !== expected) {
      throw new Error(
        `encodeHeightMap: byte length ${bytes.length} != expected ${expected} for width ${width}`,
      )
    }
    const chunks: Buffer[] = []
    for (let off = 0; off < bytes.length; off += maxChunkBytes) {
      chunks.push(bytes.subarray(off, Math.min(off + maxChunkBytes, bytes.length)))
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return {
      width,
      encoding: 'raw-u16-le',
      totalBytes: bytes.length,
      sha256,
      chunks,
    }
  }

  /**
   * Reassemble the chunks emitted by `encodeHeightMap` back into a
   * single contiguous buffer. Trivial today (`Buffer.concat`); kept
   * as a public method so the joiner-side apply path doesn't reach
   * into Node primitives directly and so a future zlib variant has a
   * single decode point.
   */
  decodeHeightMap(chunks: Buffer[]): Buffer {
    return Buffer.concat(chunks)
  }

  /**
   * Hash the bytes a freshly-loaded `.ter` file would produce. Joiners
   * call this against the stock level file the host advertised; if the
   * digest matches `EncodedTerrainHeightMap.sha256` we skip the
   * download entirely (base-match short-circuit, see #14).
   */
  hashRawHeightBytes(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex')
  }
}
