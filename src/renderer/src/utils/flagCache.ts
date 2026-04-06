import { useSyncExternalStore } from 'react'

const cache = new Map<string, string>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(): void {
  listeners.forEach((l) => l())
}

/** Synchronously read a cached flag data URL. Returns null if not yet loaded. */
export function getCachedFlag(code: string): string | null {
  return cache.get(code.toLowerCase()) ?? null
}

/** React hook — returns a cached data URL for the flag, or null if pending. */
export function useFlagUrl(code: string): string | null {
  const key = code?.toLowerCase() ?? ''
  return useSyncExternalStore(subscribe, () => cache.get(key) ?? null)
}

/** Batch-fetch and cache flag images for an array of country codes. */
export async function prefetchFlags(codes: string[]): Promise<void> {
  const unique = [...new Set(codes.map((c) => c.toLowerCase()).filter((c) => c && !cache.has(c)))]
  if (unique.length === 0) return
  const results = await window.api.getFlags(unique)
  let changed = false
  for (const [code, dataUrl] of Object.entries(results)) {
    if (dataUrl) {
      cache.set(code, dataUrl)
      changed = true
    }
  }
  if (changed) notify()
}
