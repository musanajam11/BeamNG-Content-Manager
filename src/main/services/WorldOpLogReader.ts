/**
 * §E.4 — Op-log reader for `.beamcmworld`.
 *
 * The on-disk op log is currently JSONL (one `OpMsg` JSON per line) per
 * the spec's "MessagePack wire format" bookmark — when msgpack lands,
 * the parser swaps but the reader's surface stays the same.
 *
 * Pure parser: takes raw bytes, returns a typed list. The actual
 * "replay into the editor" step is the caller's job. We validate
 * each entry minimally so a corrupted line doesn't poison the whole
 * log — bad lines are dropped with a warning rather than throwing.
 */

import type { OpMsg } from './transports/SessionFrame'

export interface ParsedOpLog {
  ops: OpMsg[]
  /** Number of malformed lines that were skipped. */
  skipped: number
  /** Highest `seq` value observed. Useful for relay catch-up bookkeeping. */
  maxSeq: number
}

/**
 * Parse the `oplog.msgpack` payload (currently JSONL bytes) into a
 * typed `OpMsg[]`. Empty / null input returns an empty result.
 */
export function parseWorldOpLog(bytes: Buffer | null): ParsedOpLog {
  if (!bytes || bytes.length === 0) {
    return { ops: [], skipped: 0, maxSeq: 0 }
  }
  const text = bytes.toString('utf8')
  const lines = text.split(/\r?\n/)
  const ops: OpMsg[] = []
  let skipped = 0
  let maxSeq = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      const obj = JSON.parse(trimmed) as unknown
      if (!isOpMsg(obj)) {
        skipped++
        continue
      }
      ops.push(obj)
      if (obj.seq > maxSeq) maxSeq = obj.seq
    } catch {
      skipped++
    }
  }
  if (skipped > 0) {
    console.warn(`[WorldOpLogReader] skipped ${skipped} malformed line(s)`)
  }
  return { ops, skipped, maxSeq }
}

/**
 * Minimal structural validator. We don't enforce the full op shape
 * (the apply pipeline does that); just confirm the envelope fields
 * the relay needs to route the op are present and well-typed.
 */
function isOpMsg(v: unknown): v is OpMsg {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    o.type === 'op' &&
    typeof o.seq === 'number' &&
    typeof o.authorId === 'string' &&
    (o.kind === 'do' || o.kind === 'undo' || o.kind === 'redo')
  )
}
