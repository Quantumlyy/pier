import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { SiweMessage } from 'siwe'
import { privateKeyToAccount } from 'viem/accounts'

import { buildApp } from '../src/index.ts'
import { ensCache } from '../src/lib/cache.ts'
import {
  ensDomain,
  gqlOk,
  installFetch,
  req,
  restoreFetch,
} from './helpers.ts'

let app: ReturnType<typeof buildApp>

beforeAll(() => {
  app = buildApp()
})

beforeEach(() => {
  ensCache.clear()
})

afterEach(() => {
  restoreFetch()
})

const json = async <T = unknown>(r: Request): Promise<{ status: number; body: T; headers: Headers }> => {
  const res = await app.handle(r)
  const text = await res.text()
  let body: T
  try {
    body = (text ? JSON.parse(text) : null) as T
  } catch {
    body = text as unknown as T
  }
  return { status: res.status, body, headers: res.headers }
}

const text = async (r: Request) => {
  const res = await app.handle(r)
  return { status: res.status, body: await res.text(), headers: res.headers }
}

// ─── Helpers for the SIWE tests ─────────────────────────────────────────────
const SIGNER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const SIGNER = privateKeyToAccount(SIGNER_PK)

const signSiwe = async (overrides: Partial<SiweMessage> = {}, nonce?: string): Promise<{ message: string; signature: string }> => {
  const issuedNonce =
    nonce ??
    (await (async () => {
      const r = await text(req.get('/nonce'))
      return r.body
    })())
  const msg = new SiweMessage({
    domain: 'localhost:3071',
    address: SIGNER.address,
    uri: 'http://localhost:3071',
    version: '1',
    chainId: 1,
    nonce: issuedNonce,
    issuedAt: new Date().toISOString(),
    ...overrides,
  })
  const message = msg.prepareMessage()
  const signature = await SIGNER.signMessage({ message })
  return { message, signature }
}

const signIn = async (): Promise<string> => {
  const { message, signature } = await signSiwe()
  const res = await app.handle(req.post('/verify', { message, signature }))
  const sc = res.headers.get('set-cookie') ?? ''
  return sc.match(/id=([^;]+)/)?.[1] ?? ''
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET /health_check', () => {
  test('returns { stable: true }', async () => {
    const r = await json<{ stable: boolean }>(req.get('/health_check'))
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ stable: true })
  })
})

describe('CORS', () => {
  test('preflight from allowed origin echoes the origin and credentials', async () => {
    const r = await text(
      req.options('/health_check', {
        origin: 'http://localhost:3071',
        'access-control-request-method': 'GET',
      }),
    )
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:3071')
    expect(r.headers.get('access-control-allow-credentials')).toBe('true')
    expect(r.headers.get('vary')).toContain('Origin')
  })

  test('preflight from disallowed origin omits the ACAO header', async () => {
    const r = await text(
      req.options('/health_check', {
        origin: 'http://evil.example.com',
        'access-control-request-method': 'GET',
      }),
    )
    expect(r.headers.get('access-control-allow-origin')).not.toBe('http://evil.example.com')
  })
})

describe('GET /nonce', () => {
  test('returns plaintext nonce of non-trivial length', async () => {
    const r = await text(req.get('/nonce'))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/plain')
    expect(r.body.length).toBeGreaterThan(8)
  })

  test('wipes the existing session', async () => {
    const sid = await signIn()
    const before = await json(req.get('/authenticate', { id: sid }))
    expect(before.status).toBe(200)
    await text(req.get('/nonce', { id: sid }))
    const after = await json(req.get('/authenticate', { id: sid }))
    expect(after.status).toBe(401)
  })
})

describe('POST /verify', () => {
  test('rejects malformed body shape', async () => {
    const r = await json(req.post('/verify', { wrong: 'shape' }))
    expect(r.status).toBe(422) // Elysia body validation rejects with 422 when schema is set
  })

  test('rejects bogus SIWE message string', async () => {
    const r = await json(req.post('/verify', { message: 'not a siwe message', signature: '0x00' }))
    expect(r.status).toBe(400)
  })

  test('rejects domain not in ALLOWED_ORIGINS', async () => {
    const { message, signature } = await signSiwe({ domain: 'evil.example.com', uri: 'https://evil.example.com' })
    const r = await json<{ error: string }>(req.post('/verify', { message, signature }))
    expect(r.status).toBe(422)
    expect(r.body.error).toContain('evil.example.com')
  })

  test('rejects an unknown nonce', async () => {
    const { message, signature } = await signSiwe({}, 'NotAnIssuedNonce123456789')
    const r = await json<{ error: string }>(req.post('/verify', { message, signature }))
    expect(r.status).toBe(422)
    expect(r.body.error).toContain('nonce')
  })

  test('rejects a tampered signature', async () => {
    const { message } = await signSiwe()
    const r = await json(
      req.post('/verify', { message, signature: '0x' + '0'.repeat(130) }),
    )
    expect(r.status).toBe(422)
  })

  test('happy path returns 200, sets the id cookie, address survives /authenticate', async () => {
    const { message, signature } = await signSiwe()
    const res = await app.handle(req.post('/verify', { message, signature }))
    expect(res.status).toBe(200)
    const sc = res.headers.get('set-cookie')
    expect(sc).toMatch(/^id=[a-f0-9-]+;/)
    const sid = sc?.match(/id=([^;]+)/)?.[1] ?? ''
    const auth = await json<{ address: string }>(req.get('/authenticate', { id: sid }))
    expect(auth.status).toBe(200)
    expect(auth.body.address).toBe(SIGNER.address.toLowerCase())
  })

  test('replay of the same message+signature is rejected as nonce already consumed', async () => {
    const { message, signature } = await signSiwe()
    const a = await app.handle(req.post('/verify', { message, signature }))
    expect(a.status).toBe(200)
    const b = await json<{ error: string }>(req.post('/verify', { message, signature }))
    expect(b.status).toBe(422)
    expect(b.body.error).toContain('nonce')
  })
})

describe('GET /authenticate', () => {
  test('401 without session', async () => {
    const r = await json(req.get('/authenticate'))
    expect(r.status).toBe(401)
  })

  test('200 with cookie', async () => {
    const sid = await signIn()
    const r = await json(req.get('/authenticate', { cookie: `id=${sid}` }))
    expect(r.status).toBe(200)
  })

  test('200 with id header', async () => {
    const sid = await signIn()
    const r = await json(req.get('/authenticate', { id: sid }))
    expect(r.status).toBe(200)
  })
})

describe('GET /search/plain', () => {
  test('empty query returns empty array without hitting upstream', async () => {
    const { calls } = installFetch(() => gqlOk({ domains: [] }))
    const r = await json<{ domains: unknown[] }>(req.get('/search/plain'))
    expect(r.status).toBe(200)
    expect(r.body.domains).toEqual([])
    expect(calls).toHaveLength(0)
  })

  test('passes prefix to ENSNode and shapes results', async () => {
    const { calls } = installFetch(() => gqlOk({ domains: [ensDomain('vital.eth')] }))
    const r = await json<{ domains: { name: string; name_ens: string }[] }>(
      req.get('/search/plain?name=vital&limit=5&offset=0'),
    )
    expect(r.status).toBe(200)
    expect(r.body.domains).toHaveLength(1)
    expect(r.body.domains[0]?.name).toBe('vital.eth')
    expect(r.body.domains[0]?.name_ens).toBe('vital')
    expect(calls[0]?.body?.variables.prefix).toBe('vital')
  })

  test('strips trailing .eth before searching', async () => {
    const { calls } = installFetch(() => gqlOk({ domains: [] }))
    await json(req.get('/search/plain?name=vitalik.eth&limit=1'))
    expect(calls[0]?.body?.variables.prefix).toBe('vitalik')
  })
})

describe('GET /search/similar', () => {
  test('uses substring match (name_contains)', async () => {
    const { calls } = installFetch(() => gqlOk({ domains: [ensDomain('foo.eth')] }))
    const r = await json(req.get('/search/similar?name=oo&limit=1'))
    expect(r.status).toBe(200)
    expect(calls[0]?.body?.variables.needle).toBe('oo')
  })
})

describe('GET /roll', () => {
  test('returns up to limit domains from the hardcoded pool', async () => {
    installFetch(() =>
      gqlOk({
        domains: [
          ensDomain('vitalik.eth'),
          ensDomain('nick.eth'),
          ensDomain('ethereum.eth'),
        ],
      }),
    )
    const r = await json<{ domains: { name: string }[] }>(req.get('/roll?limit=2'))
    expect(r.status).toBe(200)
    expect(r.body.domains.length).toBeLessThanOrEqual(2)
    for (const d of r.body.domains) expect(d.name).toMatch(/\.eth$/)
  })
})

describe('GET /info/domain/expires', () => {
  test('returns the registrar expiry for ENS names', async () => {
    installFetch(() =>
      gqlOk({
        domains: [
          ensDomain('vitalik.eth', {
            expiryDate: '2468928330',
            registration: { registrationDate: '1581013420', expiryDate: '2461152330' },
          }),
        ],
      }),
    )
    const r = await json<{ domains: { domain: string; expires: number }[] }>(
      req.get('/info/domain/expires?domains=vitalik.eth'),
    )
    expect(r.body.domains).toEqual([{ domain: 'vitalik.eth', expires: 2461152330 }])
  })

  test('returns expires:0 for hex tokenIds', async () => {
    installFetch(() => gqlOk({ domains: [] }))
    const r = await json<{ domains: { domain: string; expires: number }[] }>(
      req.get('/info/domain/expires?domains=0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
    )
    expect(r.body.domains[0]?.expires).toBe(0)
  })

  test('empty query returns empty array', async () => {
    const r = await json<{ domains: unknown[] }>(req.get('/info/domain/expires'))
    expect(r.body.domains).toEqual([])
  })
})

describe('GET /info/domain/categories', () => {
  test('echoes the requested domains with empty categories', async () => {
    const r = await json<{ domains: { domain: string; categories: unknown[] }[] }>(
      req.get('/info/domain/categories?domains=foo.eth,bar.eth'),
    )
    expect(r.body.domains).toEqual([
      { domain: 'foo.eth', categories: [] },
      { domain: 'bar.eth', categories: [] },
    ])
  })
})

describe('GET /domains/owner', () => {
  test('returns shaped results for a valid address', async () => {
    installFetch(() => gqlOk({ domains: [ensDomain('a.eth'), ensDomain('b.eth')] }))
    const r = await json<{ domains: unknown[] }>(
      req.get('/domains/owner?owner=0xd8da6bf26964af9d7eed9e03e53415d37aa96045&limit=5'),
    )
    expect(r.status).toBe(200)
    expect(r.body.domains).toHaveLength(2)
  })

  test('returns empty array for invalid address', async () => {
    const { calls } = installFetch(() => gqlOk({ domains: [] }))
    const r = await json<{ domains: unknown[] }>(req.get('/domains/owner?owner=not-an-address'))
    expect(r.body.domains).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('GET /total_stats', () => {
  test('returns full TotalStatsType with zero defaults', async () => {
    const r = await json<Record<string, string>>(req.get('/total_stats'))
    expect(r.body).toEqual({
      average_sale: '0',
      daily_sales: '0',
      highest_reg: '0',
      highest_reg_domain_name: '',
      highest_sale: '0',
      last_reg: '0',
      last_reg_domain_name: '',
      last_sale: '0',
      last_sale_domain_name: '',
      reg_volume_day: '0',
      trending_category: '',
      trending_category_volume: '0',
      volume_day: '0',
      volume_month: '0',
      volume_week: '0',
    })
  })
})

describe('GET /floor_price', () => {
  test('always returns empty domains array', async () => {
    const r = await json<{ domains: unknown[] }>(req.get('/floor_price?category=art'))
    expect(r.body.domains).toEqual([])
  })
})

describe('feed routes', () => {
  test('/feed/events → empty events', async () => {
    const r = await json<{ events: unknown[] }>(req.get('/feed/events'))
    expect(r.body.events).toEqual([])
  })
  test('/feed/aggregate → empty aggregations', async () => {
    const r = await json<{ aggregations: unknown[] }>(req.get('/feed/aggregate'))
    expect(r.body.aggregations).toEqual([])
  })
  test('/feed/activity/domain → empty events', async () => {
    const r = await json<{ events: unknown[] }>(req.get('/feed/activity/domain?domain_name=foo.eth'))
    expect(r.body.events).toEqual([])
  })
})

describe('auth-gated user routes', () => {
  test('GET /user/like 401 without session', async () => {
    const r = await json(req.get('/user/like'))
    expect(r.status).toBe(401)
  })

  test('GET /user/like 200 + empty domains when authed', async () => {
    const sid = await signIn()
    const r = await json<{ domains: unknown[] }>(req.get('/user/like', { id: sid }))
    expect(r.status).toBe(200)
    expect(r.body.domains).toEqual([])
  })

  test('POST /user/like 204 when authed', async () => {
    const sid = await signIn()
    const r = await text(req.post('/user/like', { domain_id: 'foo' }, { id: sid }))
    expect(r.status).toBe(204)
  })

  test('DELETE /user/like 204 when authed', async () => {
    const sid = await signIn()
    const r = await text(req.del('/user/like', { domain_id: 'foo' }, { id: sid }))
    expect(r.status).toBe(204)
  })

  test('GET /user/cart/list 200 [] when authed', async () => {
    const sid = await signIn()
    const r = await json<unknown[]>(req.get('/user/cart/list', { id: sid }))
    expect(r.status).toBe(200)
    expect(r.body).toEqual([])
  })

  test('POST /user/cart/modify 204 when authed', async () => {
    const sid = await signIn()
    const r = await text(
      req.post('/user/cart/modify', { basket: 'PURCHASE', id: 'vitalik.eth' }, { id: sid }),
    )
    expect(r.status).toBe(204)
  })

  test('DELETE /user/cart/modify 204 when authed', async () => {
    const sid = await signIn()
    const r = await text(
      req.del('/user/cart/modify', { basket: 'PURCHASE', id: 'vitalik.eth' }, { id: sid }),
    )
    expect(r.status).toBe(204)
  })

  test('DELETE /user/cart/clear 204 when authed', async () => {
    const sid = await signIn()
    const r = await text(req.del('/user/cart/clear', undefined, { id: sid }))
    expect(r.status).toBe(204)
  })
})

describe('docs', () => {
  test('GET /docs serves the Scalar HTML', async () => {
    const r = await text(req.get('/docs'))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/html')
  })

  test('GET /docs/json serves the OpenAPI spec', async () => {
    const r = await json<{ paths: Record<string, unknown> }>(req.get('/docs/json'))
    expect(r.status).toBe(200)
    expect(Object.keys(r.body.paths).length).toBeGreaterThan(15)
  })
})

describe('not found', () => {
  test('unknown route returns a JSON error', async () => {
    const r = await json<{ error: string }>(req.get('/does-not-exist'))
    expect(r.status).toBe(404)
    expect(r.body.error).toBe('not found')
  })
})
