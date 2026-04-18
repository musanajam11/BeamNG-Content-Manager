/**
 * Minimal LRU cache backed by a Map (insertion-order).
 * On set, if size exceeds maxSize, the oldest entry is evicted.
 * On get, the entry is refreshed to most-recently-used.
 */
export class LRUCache<K, V> {
  private map = new Map<K, V>()

  constructor(private readonly maxSize: number = 50) {
    if (maxSize <= 0) throw new Error('LRUCache: maxSize must be > 0')
  }

  get size(): number {
    return this.map.size
  }

  has(key: K): boolean {
    return this.map.has(key)
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const v = this.map.get(key) as V
    // refresh recency
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value as K | undefined
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, value)
  }

  delete(key: K): boolean {
    return this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  keys(): IterableIterator<K> {
    return this.map.keys()
  }
}
