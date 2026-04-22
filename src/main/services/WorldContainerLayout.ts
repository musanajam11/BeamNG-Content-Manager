/**
 * §E.2 — `.beamcmworld` container layout (TypeScript surface).
 *
 * A `.beamcmworld` is a deflate-compressed zip containing a fixed file
 * tree. This module defines the JSON-shaped pieces (manifest, mods
 * manifest) and the canonical entry path constants. The binary pieces
 * (snapshot.snap, terrain/*.bin, forest/*.msgpack, mods/*.zip,
 * preview.png, oplog.msgpack) are written/read by `WorldSaveService`
 * directly using the helpers in `TerrainSnapshotService`,
 * `ForestSnapshotService` and `ModInventoryService`.
 *
 * The layout is intentionally flat under a single root so it round-trips
 * through any zip GUI (drag-into-7-Zip support is a stated requirement
 * in spec §E.2).
 */

/** Bumped only on breaking schema changes per spec §E.5. */
export const BEAMCMWORLD_FORMAT_VERSION = 1

/**
 * Canonical entry paths inside the zip. Centralised here so writer and
 * reader can never drift; every other consumer should reference these
 * constants instead of hard-coding strings.
 */
export const BEAMCMWORLD_PATHS = {
  manifest: 'manifest.json',
  snapshot: 'snapshot.snap',
  terrainHeightmap: 'terrain/heightmap.bin',
  terrainMaterial: (layer: number): string => `terrain/material-${layer}.bin`,
  terrainBaseHash: 'terrain/baseHash.txt',
  forestGroup: (groupIndex: number): string => `forest/group-${groupIndex}.msgpack`,
  modsManifest: 'mods.manifest.json',
  mods: (modId: string): string => `mods/${modId}.zip`,
  oplog: 'oplog.msgpack',
  preview: 'preview.png',
  /**
   * Optional embedded "lightweight project zip" — see §E.6. When a
   * user converts an existing CM project zip into a `.beamcmworld`,
   * we stash the original zip here verbatim so the reverse conversion
   * (World → Project) is lossless. Worlds saved from a live editing
   * session won't have this entry.
   */
  embeddedProject: 'project.zip',
} as const

/**
 * Top-level world manifest. Lives at `manifest.json`. Everything that
 * cannot be reliably re-derived from the binary sections is captured
 * here. Anything that *can* be derived (e.g. mod hashes — they live
 * inside `mods.manifest.json`) is intentionally omitted to keep this
 * single source of truth.
 */
export interface WorldManifest {
  formatVersion: number
  /** Stock BeamNG level identifier (e.g. "italy", "smallgrid"). */
  levelName: string
  /** BeamNG game build that produced this save (best-effort string). */
  beamngBuild?: string
  /** UUID minted at first save; preserved across re-saves of the same world. */
  worldId: string
  /** Free-form title shown in CM. */
  title: string
  description?: string
  /** Stable list of every author (BeamMP username when known) who edited. */
  contributors: Array<{ authorId: string; displayName: string; beamUsername?: string }>
  /** Wall-clock ms. */
  createdAt: number
  modifiedAt: number
  /**
   * Optional thumbnail metadata; the actual PNG lives at preview.png.
   * Width/height are duplicated here so an "inspect" call can show the
   * size without unpacking the image.
   */
  preview?: { width: number; height: number; bytes: number }
  /**
   * Section presence flags so a v1 reader can check what's inside
   * without scanning the zip directory. New optional sections (E.5)
   * grow this map; unknown keys are ignored on read.
   */
  sections: {
    snapshot: boolean
    terrain: boolean
    forest: boolean
    mods: boolean
    oplog: boolean
    preview: boolean
    /** §E.6 — true when the original CM project zip is embedded at `project.zip`. */
    embeddedProject?: boolean
  }
}

/**
 * `mods.manifest.json` — copy of the host-side `ModManifest` from §3.
 * Re-declared here as a type so the world container stays standalone
 * (no runtime dependency on ModInventoryService for *reading*).
 */
export interface WorldModsManifest {
  /** Same shape as ModInventoryService.ModManifest — kept structural. */
  mods: Array<{
    /** Stable per-mod id (BeamNG repo id when known, else hashed name). */
    modId: string
    /** Display name shown in CM. */
    name: string
    /** Source filename (e.g. "italy_traffic.zip"). */
    filename: string
    /** Bytes of the zip blob stored at `mods/<modId>.zip`. */
    sizeBytes: number
    /** sha256 of the zip blob (hex). Equals the bridge manifest hash. */
    sha256: string
    /** Optional source URL for "where did this come from" UI. */
    sourceUrl?: string
  }>
}

/** Result of inspecting a `.beamcmworld` without unpacking. */
export interface WorldInspectResult {
  manifest: WorldManifest
  /** Total compressed size of the container on disk. */
  compressedBytes: number
  /** Sum of uncompressed entry sizes. */
  uncompressedBytes: number
  /** Number of entries in the zip directory. */
  entryCount: number
}
