/**
 * §D.2 — derive the inverse of a captured `do` envelope.
 *
 * The Lua side already snapshots `before` values into the action `data`
 * payload (e.g. `oldFieldValue` next to `newFieldValue`, `oldTransform` next
 * to `newTransform` for the actions we care about). We only have to flip
 * those references and re-emit the envelope as a fresh `do` op so every
 * peer applies it through the normal commitAction path.
 *
 * This file is intentionally narrow: each branch covers one action name
 * and is unit-testable in isolation. Anything we do not understand returns
 * `null`; the caller surfaces a "this op cannot be undone yet" toast and
 * leaves the world unchanged. Object create/delete inversion is in #23 —
 * see `buildCreateDeleteInverse` below.
 */
import { randomUUID } from 'node:crypto'

import type { LuaOpEnvelope } from './EditorSyncBridgeSocket'

/** A small JSON-ish object we know how to clone safely. */
type Json = Record<string, unknown>

function isJson(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep-ish clone restricted to JSON-safe values (strings, numbers, plain
 *  objects/arrays, nulls). Sufficient for `data` payloads — Lua's
 *  `sanitise` already stripped functions and userdata. */
function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/**
 * Wrap `data` into a fresh envelope ready to be re-broadcast as a `do`.
 * `kind` stays "do" because the receiver applies it identically — the
 * fact that we synthesised it from an undo press is purely a CM-side
 * concept (per spec §D.2: "The inverse is submitted as a *new* op").
 */
function makeEnvelope(name: string, data: Json, sourceTs: number): LuaOpEnvelope {
  return {
    kind: 'do',
    clientOpId: randomUUID(),
    ts: Date.now(),
    name,
    data,
    detail: `undo: ${name}`,
    targets: undefined,
    // Carry forward the original ts so consumers can correlate.
    sourceTs,
  } as LuaOpEnvelope & { sourceTs: number }
}

/**
 * Build the inverse envelope of `env`, or `null` if we don't know how.
 * The caller (controller) is expected to broadcast it as a normal op.
 *
 * Open coverage gap: forest/decal/road actions still return `null`. They
 * land in #23 / a follow-up because their `data` shape stores the *new*
 * state but the *old* state lives in the editor's native history stack.
 * Inverting those requires either a richer Lua-side capture (extending
 * the commitAction shim to dump the previous tile/node/instance set) or
 * round-tripping through `editor.history:undo()` on the host — both
 * outside this PR's scope.
 */
export function buildInverseOp(env: LuaOpEnvelope): LuaOpEnvelope | null {
  if (env.kind !== 'do') return null
  const name = env.name
  if (!name) return null
  if (!isJson(env.data)) return null
  const data = env.data

  switch (name) {
    // ─── Single-object transform ───────────────────────────────────────
    // SetObjectTransform / SetObjectScale carry both old + new payloads
    // captured by Lua; swap them and reuse the action.
    case 'SetObjectTransform':
    case 'SetObjectScale': {
      const out = cloneJson(data)
      if ('oldTransform' in out && 'newTransform' in out) {
        const tmp = out.newTransform
        out.newTransform = out.oldTransform
        out.oldTransform = tmp
      }
      if ('oldPosition' in out && 'newPosition' in out) {
        const tmp = out.newPosition
        out.newPosition = out.oldPosition
        out.oldPosition = tmp
      }
      if ('oldScale' in out && 'newScale' in out) {
        const tmp = out.newScale
        out.newScale = out.oldScale
        out.oldScale = tmp
      }
      return makeEnvelope(name, out, env.ts)
    }

    // ─── Field writes ──────────────────────────────────────────────────
    // ChangeField / ChangeDynField use {oldFieldValue, newFieldValue}.
    // ChangeFieldMultipleValues batches per-object {oldFieldValues, newFieldValues}.
    case 'ChangeField':
    case 'ChangeDynField': {
      const out = cloneJson(data)
      if (!('oldFieldValue' in out)) return null
      const oldVal = out.oldFieldValue
      out.newFieldValue = oldVal
      // Keep `oldFieldValue` set to what was previously `new` so a
      // subsequent redo can flip it back.
      out.oldFieldValue = (data as Json).newFieldValue
      return makeEnvelope(name, out, env.ts)
    }

    case 'ChangeFieldMultipleValues': {
      const out = cloneJson(data)
      if (!('oldFieldValues' in out) || !('newFieldValues' in out)) return null
      const tmp = out.newFieldValues
      out.newFieldValues = out.oldFieldValues
      out.oldFieldValues = tmp
      return makeEnvelope(name, out, env.ts)
    }

    // ─── Object lifecycle (§D.4) ──────────────────────────────────────
    // CreateObject ↔ DeleteObject. The pid is reused on redo per spec
    // §D.4 ("Mapping survives undo/redo: …rebound to the same netId").
    // Lua's CreateObject capture carries either {objectId, classname,
    // name, transform, ...} or just {objectId} (asset-browser drop) —
    // either way we have a target id to delete.
    case 'CreateObject': {
      const objectId = (data.objectId ?? data.objectID) as unknown
      if (typeof objectId !== 'number' && typeof objectId !== 'string') return null
      return makeEnvelope('DeleteObject', { objectId }, env.ts)
    }

    // DeleteObject undo recreates the object from the snapshot Lua
    // captured before deletion. The shim must store enough of the dead
    // object's transform/fields under data.before for this to work; if
    // the capture is bare we cannot reconstruct and bail out.
    case 'DeleteObject': {
      const objectId = data.objectId as unknown
      if (typeof objectId !== 'number' && typeof objectId !== 'string') return null
      const before = data.before
      if (!isJson(before)) return null
      // Re-emit as CreateObject preserving the original pid so persistent
      // references (parents, links, follow-up edits in our own undo
      // stack) keep resolving on every peer.
      const create: Json = {
        objectId,
        classname: before.classname ?? before.className,
        className: before.className ?? before.classname,
        name: before.name,
        transform: before.transform,
        fields: before.fields,
        // Carry the full `before` blob through too — useful for the
        // joiner-side recreation path which wants the field map.
        before,
      }
      return makeEnvelope('CreateObject', create, env.ts)
    }

    // ─── Material editor property writes ──────────────────────────────
    // Captured shape: { matId, layer, propertyName, oldValue, newValue }.
    // The action name is the dynamic "SetMaterialProperty_<prop>_layer<N>",
    // so match on prefix instead of an exact case.
    default: {
      if (name.startsWith('SetMaterialProperty_')) {
        const out = cloneJson(data)
        if (!('oldValue' in out)) return null
        const tmp = out.newValue
        out.newValue = out.oldValue
        out.oldValue = tmp
        return makeEnvelope(name, out, env.ts)
      }
      return null
    }
  }
}
