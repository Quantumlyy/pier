import { describe, expect, test } from 'bun:test'

import { TTLCache } from '../src/lib/cache.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('TTLCache', () => {
  test('get returns undefined for missing key', () => {
    const c = new TTLCache<string>({ ttlMs: 1000, max: 10 })
    expect(c.get('missing')).toBeUndefined()
  })

  test('set / get round trip', () => {
    const c = new TTLCache<number>({ ttlMs: 1000, max: 10 })
    c.set('a', 1)
    expect(c.get('a')).toBe(1)
  })

  test('updating a key reuses the slot', () => {
    const c = new TTLCache<number>({ ttlMs: 1000, max: 2 })
    c.set('a', 1)
    c.set('a', 2)
    expect(c.get('a')).toBe(2)
  })

  test('expired entries are evicted on get', async () => {
    const c = new TTLCache<string>({ ttlMs: 30, max: 10 })
    c.set('a', 'one')
    expect(c.get('a')).toBe('one')
    await sleep(60)
    expect(c.get('a')).toBeUndefined()
  })

  test('LRU eviction drops the oldest unread key when at capacity', () => {
    const c = new TTLCache<number>({ ttlMs: 1000, max: 2 })
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3)
    expect(c.get('a')).toBeUndefined()
    expect(c.get('b')).toBe(2)
    expect(c.get('c')).toBe(3)
  })

  test('get promotes a key to most-recently-used', () => {
    const c = new TTLCache<number>({ ttlMs: 1000, max: 2 })
    c.set('a', 1)
    c.set('b', 2)
    expect(c.get('a')).toBe(1) // promotes a
    c.set('c', 3) // should evict b (oldest after promotion)
    expect(c.get('a')).toBe(1)
    expect(c.get('b')).toBeUndefined()
    expect(c.get('c')).toBe(3)
  })

  test('delete removes a single entry', () => {
    const c = new TTLCache<string>({ ttlMs: 1000, max: 10 })
    c.set('a', 'one')
    c.delete('a')
    expect(c.get('a')).toBeUndefined()
  })

  test('clear empties the cache', () => {
    const c = new TTLCache<string>({ ttlMs: 1000, max: 10 })
    c.set('a', 'one')
    c.set('b', 'two')
    c.clear()
    expect(c.get('a')).toBeUndefined()
    expect(c.get('b')).toBeUndefined()
  })

  test('getOrSet caches the result of the loader', async () => {
    const c = new TTLCache<number>({ ttlMs: 1000, max: 10 })
    let calls = 0
    const loader = async () => {
      calls++
      return 42
    }
    expect(await c.getOrSet('k', loader)).toBe(42)
    expect(await c.getOrSet('k', loader)).toBe(42)
    expect(calls).toBe(1)
  })

  test('getOrSet single-flights concurrent calls for the same key', async () => {
    const c = new TTLCache<number>({ ttlMs: 1000, max: 10 })
    let calls = 0
    const loader = async () => {
      calls++
      await sleep(20)
      return 7
    }
    const [a, b, d] = await Promise.all([
      c.getOrSet('k', loader),
      c.getOrSet('k', loader),
      c.getOrSet('k', loader),
    ])
    expect([a, b, d]).toEqual([7, 7, 7])
    expect(calls).toBe(1)
  })

  test('getOrSet does not cache a thrown loader and clears in-flight', async () => {
    const c = new TTLCache<number>({ ttlMs: 1000, max: 10 })
    let calls = 0
    const failing = async () => {
      calls++
      throw new Error('boom')
    }
    await expect(c.getOrSet('k', failing)).rejects.toThrow('boom')
    // second call should re-invoke (no cached failure)
    await expect(c.getOrSet('k', failing)).rejects.toThrow('boom')
    expect(calls).toBe(2)
  })

  test('getOrSet refetches after TTL expiry', async () => {
    const c = new TTLCache<number>({ ttlMs: 30, max: 10 })
    let calls = 0
    const loader = async () => {
      calls++
      return calls
    }
    expect(await c.getOrSet('k', loader)).toBe(1)
    await sleep(60)
    expect(await c.getOrSet('k', loader)).toBe(2)
    expect(calls).toBe(2)
  })
})
