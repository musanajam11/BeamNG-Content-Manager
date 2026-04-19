import { useCallback, useRef, useState } from 'react'

/**
 * A bounded LRU-ish cache stored in React state.
 *
 * Backing store is a Map (insertion-ordered). When `maxSize` is exceeded the
 * oldest entry is evicted. Reading via `get` re-inserts the key so it becomes
 * the most-recently-used entry.
 *
 * Used to cap memory for things like base64 mod/map preview images that would
 * otherwise grow unbounded as the user clicks through hundreds of mods.
 */
export function useBoundedCache<V>(
  maxSize: number
): {
  get: (key: string) => V | undefined
  has: (key: string) => boolean
  set: (key: string, value: V) => void
  /** Stable identity per render; do NOT depend on this for change detection. */
  raw: Map<string, V>
} {
  const mapRef = useRef<Map<string, V>>(new Map())
  // Bump counter to trigger re-renders when the cache changes.
  const [, setVersion] = useState(0)

  const has = useCallback((key: string) => mapRef.current.has(key), [])

  const get = useCallback((key: string): V | undefined => {
    const m = mapRef.current
    const v = m.get(key)
    if (v !== undefined && m.size > 1) {
      // Touch: move to most-recent position.
      m.delete(key)
      m.set(key, v)
    }
    return v
  }, [])

  const set = useCallback((key: string, value: V): void => {
    const m = mapRef.current
    if (m.has(key)) m.delete(key)
    m.set(key, value)
    while (m.size > maxSize) {
      const oldestKey = m.keys().next().value
      if (oldestKey === undefined) break
      m.delete(oldestKey)
    }
    setVersion((v) => v + 1)
  }, [maxSize])

  return { get, has, set, raw: mapRef.current }
}
