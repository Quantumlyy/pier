import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { ensCache } from '../src/lib/cache.ts'
import {
  getDomainByName,
  getDomainsByOwner,
  getExpiryDates,
  searchByContains,
  searchByPrefix,
} from '../src/upstreams/ensnode.ts'

const realFetch = globalThis.fetch

type Capture = { url: string; method: string; body: { query: string; variables: Record<string, unknown> } }

const installFetch = (responder: (req: Capture) => Response | Promise<Response>) => {
  const calls: Capture[] = []
  const fn = mock(async (input: Request | string, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url
    const method = init?.method ?? (typeof input === 'string' ? 'GET' : input.method)
    const rawBody = init?.body ?? (typeof input === 'string' ? '' : await input.text())
    const body = rawBody ? JSON.parse(String(rawBody)) : { query: '', variables: {} }
    const cap: Capture = { url, method: method ?? 'GET', body }
    calls.push(cap)
    return responder(cap)
  })
  globalThis.fetch = fn as unknown as typeof fetch
  return { fn, calls }
}

const ok = (data: unknown) =>
  new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })

const err = (status: number, body: unknown = { message: 'upstream error' }) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  ensCache.clear()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const domain = (name: string, overrides: { owner?: string; labelName?: string } = {}) => {
  const owner = overrides.owner ?? '0xabc'
  return {
    id: '0x' + name,
    name,
    labelName: overrides.labelName ?? name.replace('.eth', ''),
    owner: { id: owner },
    wrappedOwner: null,
    registrant: { id: owner },
    expiryDate: '1700000000',
    createdAt: '1500000000',
    registration: { registrationDate: '1500000000', expiryDate: '1700000000' },
  }
}

describe('searchByPrefix', () => {
  test('hits ENSNode with the prefix variable and returns domains', async () => {
    const { calls } = installFetch(() => ok({ domains: [domain('vital.eth')] }))
    const result = await searchByPrefix('vital', 5, 10)
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('vital.eth')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body.variables).toMatchObject({ prefix: 'vital', first: 5, skip: 10 })
    expect(calls[0]?.body.variables.parentId).toMatch(/^0x[0-9a-f]{64}$/)
    expect(calls[0]?.url).toContain('ensnode')
  })

  test('caches by (prefix, first, skip)', async () => {
    const { calls } = installFetch(() => ok({ domains: [domain('foo.eth')] }))
    await searchByPrefix('foo', 5, 0)
    await searchByPrefix('foo', 5, 0) // cache hit
    await searchByPrefix('foo', 5, 5) // different skip → upstream
    expect(calls).toHaveLength(2)
  })
})

describe('searchByContains', () => {
  test('passes the needle variable', async () => {
    const { calls } = installFetch(() => ok({ domains: [] }))
    await searchByContains('itali', 3, 0)
    expect(calls[0]?.body.variables).toMatchObject({ needle: 'itali', first: 3, skip: 0 })
  })

  test('cache key is independent from searchByPrefix', async () => {
    const { calls } = installFetch(() => ok({ domains: [] }))
    await searchByPrefix('x', 1, 0)
    await searchByContains('x', 1, 0)
    expect(calls).toHaveLength(2)
  })
})

describe('getDomainsByOwner', () => {
  test('lowercases the owner address', async () => {
    const { calls } = installFetch(() => ok({ domains: [] }))
    await getDomainsByOwner('0xABCDEF1234567890ABCDEF1234567890ABCDEF12', 10, 0)
    expect(calls[0]?.body.variables.owner).toBe('0xabcdef1234567890abcdef1234567890abcdef12')
  })

  test('OR-composes ownerId, wrappedOwnerId, and registrantId in the query', async () => {
    const { calls } = installFetch(() => ok({ domains: [] }))
    await getDomainsByOwner('0xabc', 10, 0)
    const query = calls[0]?.body.query ?? ''
    expect(query).toContain('ownerId: $owner')
    expect(query).toContain('wrappedOwnerId: $owner')
    expect(query).toContain('registrantId: $owner')
    expect(query).toContain('or:')
  })

  test('returns wrapped names with the user as effective owner via shape', async () => {
    // ENSNode emits owner = NameWrapper, wrappedOwner = the user
    installFetch(() =>
      ok({
        domains: [
          {
            id: '0xfoo',
            name: 'wrapped.eth',
            labelName: 'wrapped',
            owner: { id: '0xd4416b13d2b3a9abae7acd5d6c2bbdbe25686401' },
            wrappedOwner: { id: '0xabcabcabcabcabcabcabcabcabcabcabcabcabca' },
            registrant: { id: '0xabcabcabcabcabcabcabcabcabcabcabcabcabca' },
            expiryDate: '1900000000',
            createdAt: '1500000000',
            registration: { registrationDate: '1500000000', expiryDate: '1900000000' },
          },
        ],
      }),
    )
    const result = await getDomainsByOwner('0xabcabcabcabcabcabcabcabcabcabcabcabcabca', 10, 0)
    expect(result).toHaveLength(1)
    expect(result[0]?.wrappedOwner?.id).toBe('0xabcabcabcabcabcabcabcabcabcabcabcabcabca')
  })
})

describe('getExpiryDates', () => {
  test('passes a names array to ENSNode', async () => {
    const { calls } = installFetch(() => ok({ domains: [domain('a.eth')] }))
    const result = await getExpiryDates(['a.eth', 'b.eth'])
    expect(calls[0]?.body.variables).toEqual({ names: ['a.eth', 'b.eth'] })
    expect(result).toHaveLength(1)
  })

  test('cache key is order-independent (sorted before keying)', async () => {
    const { calls } = installFetch(() => ok({ domains: [] }))
    await getExpiryDates(['a.eth', 'b.eth'])
    await getExpiryDates(['b.eth', 'a.eth'])
    expect(calls).toHaveLength(1)
  })
})

describe('getDomainByName', () => {
  test('returns the first match', async () => {
    installFetch(() => ok({ domains: [domain('vitalik.eth')] }))
    const result = await getDomainByName('vitalik.eth')
    expect(result?.name).toBe('vitalik.eth')
  })

  test('returns null when ENSNode has no match', async () => {
    installFetch(() => ok({ domains: [] }))
    const result = await getDomainByName('does-not-exist.eth')
    expect(result).toBeNull()
  })
})

describe('eth-parent + displayability filter', () => {
  test('search/owner queries pass parentId = namehash("eth")', async () => {
    const { calls } = installFetch(() => ok({ domains: [] }))
    await searchByPrefix('a', 1, 0)
    await searchByContains('b', 1, 0)
    await getDomainsByOwner('0x' + '0'.repeat(40), 1, 0)
    const eth = '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae'
    for (const c of calls) expect(c.body?.variables.parentId).toBe(eth)
  })

  test('encoded-label and multi-label results are filtered out post-fetch', async () => {
    installFetch(() =>
      ok({
        domains: [
          domain('vitalik.eth'),
          domain('[abc123].eth', { labelName: '[abc123]' }),
          domain('sub.vitalik.eth', { labelName: 'sub' }),
          { ...domain('weird.eth'), name: 'weird' }, // missing .eth
        ],
      }),
    )
    const result = await searchByPrefix('v', 10, 0)
    expect(result.map((d) => d.name)).toEqual(['vitalik.eth'])
  })
})

describe('gql error handling', () => {
  test('retries once on 5xx and succeeds on the second attempt', async () => {
    let n = 0
    const { calls } = installFetch(() => {
      n++
      return n === 1 ? err(503, 'upstream down') : ok({ domains: [domain('a.eth')] })
    })
    const result = await searchByPrefix('a', 5, 0)
    expect(calls).toHaveLength(2)
    expect(result[0]?.name).toBe('a.eth')
  })

  test('does not retry on 4xx', async () => {
    const { calls } = installFetch(() => err(400, 'bad request'))
    await expect(searchByPrefix('zz', 5, 0)).rejects.toThrow(/ENSNode 400/)
    expect(calls).toHaveLength(1)
  })

  test('throws on GraphQL errors[]', async () => {
    installFetch(
      () =>
        new Response(JSON.stringify({ errors: [{ message: 'syntax error in query' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    await expect(searchByPrefix('q', 5, 0)).rejects.toThrow(/syntax error in query/)
  })

  test('throws after retry exhaustion on persistent 5xx', async () => {
    const { calls } = installFetch(() => err(502, 'bad gateway'))
    await expect(searchByPrefix('flaky', 5, 0)).rejects.toThrow(/ENSNode 502/)
    expect(calls).toHaveLength(2)
  })
})
