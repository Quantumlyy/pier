import { Hono } from 'hono'
import { SiweMessage } from 'siwe'

import { allowedDomains } from '../env.ts'
import {
  consumeNonce,
  createSession,
  getSession,
  issueNonce,
  issueSessionCookie,
  revokeSession,
} from '../lib/session.ts'

export const authRoutes = new Hono()
  .get('/nonce', (c) => {
    // RainbowKit's signOut adapter calls GET /nonce expecting it to wipe the
    // existing session — jetty did this as a side effect of issuing a fresh
    // nonce, and the frontend explicitly comments on the behavior.
    revokeSession(c)
    c.header('content-type', 'text/plain; charset=utf-8')
    return c.body(issueNonce())
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
    if (!allowedDomains.has(parsed.domain)) {
      return c.json({ error: `domain ${parsed.domain} is not allowed` }, 422)
    }
    if (!consumeNonce(parsed.nonce)) {
      return c.json({ error: 'unknown or expired nonce' }, 422)
    }
    const result = await parsed
      .verify({ signature: body.signature, nonce: parsed.nonce, domain: parsed.domain })
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
