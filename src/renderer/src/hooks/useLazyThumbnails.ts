import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Viewport-aware thumbnail loader.
 *
 * Why: with infinite scroll the mod lists can grow into the hundreds. Eagerly
 * proxy-fetching every thumbnail base64 blows up renderer memory; relying
 * solely on a bulk effect on the `mods` array breaks when the bounded LRU
 * evicts older entries — when the user scrolls back up, the spinner stays
 * forever because nothing re-requests the missing url.
 *
 * Cards register their url via `useLazyThumb` only when scrolled into view;
 * the loader coalesces requests into small batches, stores results in a
 * bounded LRU, and pins currently-visible entries so they are never evicted
 * while a card is still mounted on them. Pinning prevents thrash where a
 * fast scroll could otherwise evict an on-screen card's thumbnail and
 * trigger an immediate re-request loop.
 */

const BATCH_DELAY_MS = 80
const MAX_BATCH = 24

export interface ThumbnailLoader {
  /** Returns the cached data url. */
  get: (url: string | null | undefined) => string | undefined
  /** Schedules a fetch for `url` if not already cached or in-flight. */
  request: (url: string | null | undefined) => void
  /**
   * Pin `url` so the LRU won't evict it. Returns an unpin function. Multiple
   * subscribers to the same url ref-count; eviction is allowed only when
   * the count drops to zero.
   */
  subscribe: (url: string | null | undefined) => () => void
  /** Returns true once a fetch attempt for `url` has completed (with or without data). */
  attempted: (url: string | null | undefined) => boolean
  /** Bumped whenever new thumbnails arrive. Use as a render dependency only. */
  version: number
}

export function useLazyThumbnails(
  fetcher: (urls: string[]) => Promise<Record<string, string>>,
  maxSize = 120
): ThumbnailLoader {
  const cacheRef = useRef<Map<string, string>>(new Map())
  const inFlightRef = useRef<Set<string>>(new Set())
  const pendingRef = useRef<Set<string>>(new Set())
  // Set of urls that were fetched but produced no data — short-circuits the
  // spinner UI so consumers can show a fallback icon.
  const attemptedRef = useRef<Set<string>>(new Set())
  // Ref-count of mounted subscribers per url. A url with refs > 0 is pinned
  // and won't be evicted even if it is the LRU candidate.
  const refsRef = useRef<Map<string, number>>(new Map())
  const timerRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  // Trim the cache, skipping pinned (subscribed) entries. If everything
  // currently in the cache is pinned the cache temporarily exceeds maxSize
  // — that's fine and self-corrects as soon as cards scroll out of view.
  const trim = useCallback((): void => {
    const cache = cacheRef.current
    const refs = refsRef.current
    if (cache.size <= maxSize) return
    let toRemove = cache.size - maxSize
    // Map iteration is insertion-ordered (LRU at the front).
    for (const k of Array.from(cache.keys())) {
      if (toRemove <= 0) break
      if ((refs.get(k) ?? 0) > 0) continue
      cache.delete(k)
      toRemove--
    }
  }, [maxSize])

  const flush = useCallback(() => {
    timerRef.current = null
    const pending = pendingRef.current
    if (pending.size === 0) return
    const urls = Array.from(pending).slice(0, MAX_BATCH)
    for (const u of urls) {
      pending.delete(u)
      inFlightRef.current.add(u)
    }
    void fetcher(urls)
      .then((result) => {
        if (cancelledRef.current) return
        const cache = cacheRef.current
        for (const u of urls) {
          inFlightRef.current.delete(u)
          const data = result[u]
          if (data) {
            if (cache.has(u)) cache.delete(u)
            cache.set(u, data)
          } else {
            // Negative-cache sentinel: prevents infinite spinners on rows
            // whose source has no preview (e.g. a .zip without a preview.png
            // and no registry thumbnail). Consumers treat empty string as
            // "tried, nothing to render".
            attemptedRef.current.add(u)
          }
        }
        trim()
        setVersion((v) => v + 1)
        // If more requests arrived while this batch was in flight, schedule
        // another flush so they aren't stranded.
        if (pendingRef.current.size > 0 && timerRef.current == null) {
          timerRef.current = window.setTimeout(flush, BATCH_DELAY_MS)
        }
      })
      .catch(() => {
        for (const u of urls) {
          inFlightRef.current.delete(u)
          attemptedRef.current.add(u)
        }
        setVersion((v) => v + 1)
        if (pendingRef.current.size > 0 && timerRef.current == null) {
          timerRef.current = window.setTimeout(flush, BATCH_DELAY_MS)
        }
      })
  }, [fetcher, trim])

  const request = useCallback(
    (url: string | null | undefined): void => {
      if (!url) return
      if (cacheRef.current.has(url)) return
      if (attemptedRef.current.has(url)) return
      if (inFlightRef.current.has(url) || pendingRef.current.has(url)) return
      pendingRef.current.add(url)
      if (timerRef.current == null) {
        timerRef.current = window.setTimeout(flush, BATCH_DELAY_MS)
      }
    },
    [flush]
  )

  const get = useCallback((url: string | null | undefined): string | undefined => {
    if (!url) return undefined
    return cacheRef.current.get(url)
  }, [])

  const attempted = useCallback((url: string | null | undefined): boolean => {
    if (!url) return false
    return attemptedRef.current.has(url) || cacheRef.current.has(url)
  }, [])

  const subscribe = useCallback((url: string | null | undefined): (() => void) => {
    if (!url) return () => undefined
    const refs = refsRef.current
    refs.set(url, (refs.get(url) ?? 0) + 1)
    return () => {
      const next = (refs.get(url) ?? 1) - 1
      if (next <= 0) refs.delete(url)
      else refs.set(url, next)
    }
  }, [])

  return { get, request, subscribe, attempted, version }
}

/**
 * Per-element observer hook. Attach `ref` to a card; when the card enters
 * the viewport (or comes within `rootMargin`), the thumbnail at `url` is
 * requested and the url is pinned so it cannot be evicted while the card
 * remains mounted on it. Pin is released on unmount or when url changes.
 */
export function useLazyThumb<T extends Element = HTMLDivElement>(
  url: string | null | undefined,
  loader: ThumbnailLoader,
  rootMargin = '300px'
): { ref: React.MutableRefObject<T | null>; src: string | undefined; visible: boolean; attempted: boolean } {
  const ref = useRef<T | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Latch to true on first intersection. The loader's pin/ref-count
    // already protects from eviction; we don't need to flip back to false
    // when scrolling past, which would just cause request churn.
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true)
            break
          }
        }
      },
      { rootMargin }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [rootMargin])

  // Pin the url for as long as this card is mounted on it.
  useEffect(() => {
    if (!visible || !url) return
    return loader.subscribe(url)
  }, [visible, url, loader])

  // Request once per (visible, url). Intentionally NOT depending on
  // `loader.version` — that would refire for every visible card on every
  // batch arrival and cause request storms during fast scrolling.
  useEffect(() => {
    if (!visible || !url) return
    loader.request(url)
  }, [visible, url, loader])

  // Read on every render; the loader bumps `version` on arrivals which
  // re-renders the consuming component naturally.
  const src = url ? loader.get(url) : undefined
  const attempted = url ? loader.attempted(url) : false
  return { ref, src, visible, attempted }
}
