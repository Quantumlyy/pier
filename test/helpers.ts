import { mock } from 'bun:test'

import type { ENSNodeDomain } from '../src/lib/types.ts'

export const realFetch = globalThis.fetch

export type FetchCapture = {
  url: string
  method: string
  body: { query: string; variables: Record<string, unknown> } | null
}

export type GqlHandler = (cap: FetchCapture) => Response | Promise<Response>

export const installFetch = (handler: GqlHandler) => {
  const calls: FetchCapture[] = []
  const fn = mock(async (input: Request | string, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.url
    if (!url.includes('ensnode')) return realFetch(input as Request, init)
    const method = init?.method ?? (typeof input === 'string' ? 'POST' : input.method)
    const rawBody = init?.body ?? (typeof input === 'string' ? '' : await input.text())
    let body: FetchCapture['body'] = null
    try {
      body = rawBody ? JSON.parse(String(rawBody)) : null
    } catch {
      body = null
    }
    const cap: FetchCapture = { url, method: method ?? 'POST', body }
    calls.push(cap)
    return handler(cap)
  })
  globalThis.fetch = fn as unknown as typeof fetch
  return { fn, calls }
}

export const restoreFetch = () => {
  globalThis.fetch = realFetch
}

export const gqlOk = (data: unknown): Response =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

export const gqlErr = (status: number, body: unknown = { error: 'upstream' }): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

export const ensDomain = (
  name: string,
  overrides: Partial<ENSNodeDomain> = {},
): ENSNodeDomain => ({
  id: '0x' + name,
  name,
  labelName: name.replace(/\.eth$/, ''),
  owner: { id: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' },
  registrant: { id: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' },
  expiryDate: '1700000000',
  createdAt: '1500000000',
  registration: { registrationDate: '1500000000', expiryDate: '1700000000' },
  ...overrides,
})

const mkRequest = (
  method: string,
  path: string,
  init: { headers?: Record<string, string>; body?: unknown } = {},
): Request => {
  const headers = new Headers(init.headers ?? {})
  let body: string | undefined
  if (init.body !== undefined) {
    body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
    if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  }
  return new Request(`http://localhost${path}`, { method, headers, body })
}

export const req = {
  get: (path: string, headers?: Record<string, string>) =>
    mkRequest('GET', path, headers ? { headers } : {}),
  post: (path: string, body?: unknown, headers?: Record<string, string>) =>
    mkRequest('POST', path, { body, headers }),
  del: (path: string, body?: unknown, headers?: Record<string, string>) =>
    mkRequest('DELETE', path, { body, headers }),
  options: (path: string, headers?: Record<string, string>) =>
    mkRequest('OPTIONS', path, headers ? { headers } : {}),
}
