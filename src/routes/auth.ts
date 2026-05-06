import { Hono } from 'hono'
import { SiweMessage, generateNonce } from 'siwe'

import { createSession, getSession, issueSessionCookie } from '../lib/session.ts'

export const authRoutes = new Hono()
  .get('/nonce', (c) => {
    c.header('content-type', 'text/plain; charset=utf-8')
    return c.body(generateNonce())
  })
  .post('/verify', async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { message?: unknown; signature?: unknown }
      | null
    if (!body || typeof body.message !== 'string' || typeof body.signature !== 'string') {
      return c.json({ error: 'expected { message: string, signature: string }' }, 400)
    }
    let parsed: SiweMessage
    try {
      parsed = new SiweMessage(body.message)
    } catch (err) {
      return c.json({ error: `invalid SIWE message: ${(err as Error).message}` }, 400)
    }
    const result = await parsed
      .verify({ signature: body.signature })
      .catch((err) => ({ success: false as const, error: { type: (err as Error).message } }))
    if (!result.success) {
      return c.json({ error: result.error?.type ?? 'signature verification failed' }, 422)
    }
    const { id } = createSession(parsed.address)
    issueSessionCookie(c, id)
    return c.json({ ok: true })
  })
  .get('/authenticate', (c) => {
    const session = getSession(c)
    if (!session) return c.json({ error: 'unauthenticated' }, 401)
    return c.json({ address: session.address })
  })
