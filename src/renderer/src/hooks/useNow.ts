import { useSyncExternalStore } from 'react'

// Shared 1 Hz "now" tick. Multiple components re-rendering "X ago" labels each
// used to spin up their own setInterval — with 30+ active sessions on the
// AnalyticsPanel that meant 30+ timers + 30+ React re-renders per second of an
// otherwise idle panel. One global timer + useSyncExternalStore fan-out fixes
// it: the timer only runs when at least one component is subscribed, and
// React batches the snapshot reads.

let current = Date.now()
const subscribers = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function ensureTimer(): void {
  if (timer != null) return
  timer = setInterval(() => {
    current = Date.now()
    for (const cb of subscribers) cb()
  }, 1000)
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb)
  ensureTimer()
  return () => {
    subscribers.delete(cb)
    if (subscribers.size === 0 && timer != null) {
      clearInterval(timer)
      timer = null
    }
  }
}

function getSnapshot(): number {
  return current
}

/** Returns a `Date.now()` value that ticks once per second across the app. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
