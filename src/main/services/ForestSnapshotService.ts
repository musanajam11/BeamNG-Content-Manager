/**
 * Tier 4 Phase 4 — forest instance snapshot helper (Node side).
 *
 * BeamNG's `core_forest` owns forest items (trees, bushes, etc.) on a
 * level. Per Docs/WORLD-EDITOR-SYNC.md §"Phase 4 — Forest instance
 * snapshot", every instance has `{type, pos, scale, rotation, seed?}`.
 * Lua handlers in `GameLauncherService.ts` enumerate via
 * `ForestObject:getData()` and re-apply via `ForestObject:setData()`.
 *
 * This service is the Node-side complement: it canonicalises an
 * instance list into a deterministic JSON shape so that
 *
 *   - the SHA-256 of the canonical JSON ("baseHash") is a stable
 *     identity for "the forest as it exists on disk", letting the
 *     joiner short-circuit the apply when its on-disk forest4.json
 *     hashes the same value (the same `baseMatches` optimisation
 *     used by the terrain heightmap);
 *   - the snapshot consumer sees a predictable schema regardless of
 *     which Lua field-key order or which floating-point round-trip
 *     the engine happened to produce this frame.
 *
 * Forest payloads are typically 100 KB – 5 MB even with thousands of
 * items, so we don't chunk by default — the existing `Y|` snapshot
 * frame easily carries one group's worth in a single JSON blob.
 *
 * NOT exported here: any IPC, TCP, persistence, or Lua-bridge code.
 * The caller (`EditorSyncRelayService` / `EditorSyncSessionController`)
 * handles delivery; this service is pure: in → canonical bytes → out.
 */

import { createHash } from 'crypto'

/**
 * One forest item. Coordinate / orientation conventions match the
 * Lua `ForestObject:getData()` shape verbatim — no remapping. `seed`
 * is the per-instance procedural seed Torque3D uses for placement
 * jitter; preserved so rebuilds reproduce the same jiggle.
 */
export interface ForestInstance {
  /** Item type key, e.g. `"tree_pine_01"`. Matches the `type` field. */
  type: string
  /** World-space position `[x, y, z]`. */
  pos: [number, number, number]
  /** Uniform scale multiplier; 1.0 == native item scale. */
  scale: number
  /** Quaternion rotation `[x, y, z, w]`. */
  rotation: [number, number, number, number]
  /** Optional per-instance seed for procedural variation. */
  seed?: number
}

/**
 * One forest group as it appears in a snapshot. `forestPid` matches
 * the in-scene PID of the `TSForest` (or equivalent) that owns these
 * instances; the joiner uses it to pick the right object to apply
 * `setData` against.
 */
export interface ForestGroupSnapshot {
  forestPid: string
  items: ForestInstance[]
  /**
   * Hex SHA-256 of the canonicalised items array. Used by the
   * `baseMatches` short-circuit (#14): if equal to the joiner's
   * own on-disk forest4.json hash, skip the apply entirely.
   */
  baseHash: string
  /** Set true when the host knows joiner has the same on-disk file. */
  baseMatches: boolean
}

/**
 * Top-level snapshot envelope used by the bridge / relay.
 */
export interface ForestSnapshot {
  groups: ForestGroupSnapshot[]
}

export class ForestSnapshotService {
  /**
   * Build a `ForestGroupSnapshot` from a Lua-supplied instance list.
   * Sorts items into a stable order (`type` then x then y then z) and
   * rounds floats to 6 decimal places before hashing so the same
   * underlying scene yields the same hash regardless of trivial
   * floating-point noise. The returned `items` array is the sorted
   * version — callers should ship it as-is for joiner determinism.
   *
   * `baseMatches` defaults to `false`; the relay flips it to `true`
   * after comparing `baseHash` to the joiner's on-disk hash via
   * `setBaseMatches`. Keeping it on the snapshot rather than as a
   * separate flag means a single object goes over the wire.
   */
  buildGroup(
    forestPid: string,
    items: ForestInstance[],
  ): ForestGroupSnapshot {
    const sorted = [...items].sort((a, b) => {
      if (a.type !== b.type) return a.type < b.type ? -1 : 1
      if (a.pos[0] !== b.pos[0]) return a.pos[0] - b.pos[0]
      if (a.pos[1] !== b.pos[1]) return a.pos[1] - b.pos[1]
      return a.pos[2] - b.pos[2]
    })
    const canonical = JSON.stringify(sorted, this.canonicalReplacer)
    const baseHash = createHash('sha256').update(canonical).digest('hex')
    return {
      forestPid,
      items: sorted,
      baseHash,
      baseMatches: false,
    }
  }

  /**
   * Hash a list of instances the way `buildGroup` would, without
   * keeping the sorted output. Used by the joiner to compare its own
   * on-disk forest4.json against what the host advertised, so we can
   * short-circuit the apply when both sides agree.
   */
  hashInstances(items: ForestInstance[]): string {
    const sorted = [...items].sort((a, b) => {
      if (a.type !== b.type) return a.type < b.type ? -1 : 1
      if (a.pos[0] !== b.pos[0]) return a.pos[0] - b.pos[0]
      if (a.pos[1] !== b.pos[1]) return a.pos[1] - b.pos[1]
      return a.pos[2] - b.pos[2]
    })
    const canonical = JSON.stringify(sorted, this.canonicalReplacer)
    return createHash('sha256').update(canonical).digest('hex')
  }

  /**
   * Mark a group as "joiner already has this base" (the relay calls
   * this just before sending the snapshot to a peer whose advertised
   * on-disk hash matched). Returns a new object — does not mutate.
   * Once `baseMatches` is true the joiner skips the apply, so the
   * `items` array can be elided to save bandwidth (caller's call).
   */
  setBaseMatches(group: ForestGroupSnapshot, matches: boolean): ForestGroupSnapshot {
    return { ...group, baseMatches: matches }
  }

  /**
   * JSON.stringify replacer that rounds finite numbers to 6 decimals.
   * Keeps hashes stable across micro-fp drift (same scene reloaded
   * twice in a row was producing different last-bit values, breaking
   * the baseMatches optimisation).
   */
  private readonly canonicalReplacer = (_key: string, value: unknown): unknown => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.round(value * 1e6) / 1e6
    }
    return value
  }
}
