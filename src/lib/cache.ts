type Entry<V> = { value: V; expiresAt: number }

export type CacheOpts = { ttlMs: number; max: number }

export class TTLCache<V> {
  private store = new Map<string, Entry<V>>()
  private inflight = new Map<string, Promise<V>>()

  constructor(private opts: CacheOpts) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    this.store.delete(key)
    this.store.set(key, entry)
    return entry.value
  }

  set(key: string, value: V): void {
    if (this.store.has(key)) this.store.delete(key)
    this.store.set(key, { value, expiresAt: Date.now() + this.opts.ttlMs })
    while (this.store.size > this.opts.max) {
      const oldest = this.store.keys().next().value
      if (oldest === undefined) break
      this.store.delete(oldest)
    }
  }

  async getOrSet(key: string, fn: () => Promise<V>): Promise<V> {
    const cached = this.get(key)
    if (cached !== undefined) return cached
    const existing = this.inflight.get(key)
    if (existing) return existing
    const promise = fn()
      .then((value) => {
        this.set(key, value)
        return value
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, promise)
    return promise
  }

  delete(key: string): void {
    this.store.delete(key)
    this.inflight.delete(key)
  }

  clear(): void {
    this.store.clear()
    this.inflight.clear()
  }
}

export const ensCache = new TTLCache<unknown>({ ttlMs: 30_000, max: 1000 })

/** 60s TTL for `/total_stats` registration aggregates (not `ensCache` — 30s would undercut ~1 min caching). */
export const statsAggregationCache = new TTLCache<unknown>({ ttlMs: 60_000, max: 32 })
