import { Elysia } from 'elysia'
import { SiweMessage } from 'siwe'

import { allowedDomains } from '../env.ts'
import {
  SESSION_COOKIE_NAME,
  consumeNonce,
  createSession,
  dropSession,
  issueNonce,
  readSessionId,
  resolveSession,
  sessionCookieAttrs,
} from '../lib/session.ts'

export const authRoutes = new Elysia()
  .get('/nonce', ({ cookie, headers, set }) => {
    // RainbowKit's signOut adapter calls GET /nonce expecting it to wipe the
    // existing session — jetty did this as a side effect of issuing a fresh
    // nonce, and the frontend explicitly comments on the behavior.
    const sid = readSessionId(cookie[SESSION_COOKIE_NAME]?.value, headers.id)
    dropSession(sid)
    cookie[SESSION_COOKIE_NAME]?.remove()
    set.headers['content-type'] = 'text/plain; charset=utf-8'
    return issueNonce()
  })
  .post('/verify', async ({ body, cookie, status }) => {
    if (
      !body ||
      typeof (body as { message?: unknown }).message !== 'string' ||
      typeof (body as { signature?: unknown }).signature !== 'string'
    ) {
      return status(400, { error: 'expected { message: string, signature: string }' })
    }
    const { message, signature } = body as { message: string; signature: string }
    let parsed: SiweMessage
    try {
      parsed = new SiweMessage(message)
    } catch (err) {
      return status(400, { error: `invalid SIWE message: ${(err as Error).message}` })
    }
    if (!allowedDomains.has(parsed.domain)) {
      return status(422, { error: `domain ${parsed.domain} is not allowed` })
    }
    if (!consumeNonce(parsed.nonce)) {
      return status(422, { error: 'unknown or expired nonce' })
    }
    const result = await parsed
      .verify({ signature, nonce: parsed.nonce, domain: parsed.domain })
      .catch((err) => ({ success: false as const, error: { type: (err as Error).message } }))
    if (!result.success) {
      return status(422, { error: result.error?.type ?? 'signature verification failed' })
    }
    const { id } = createSession(parsed.address)
    cookie[SESSION_COOKIE_NAME]?.set({ value: id, ...sessionCookieAttrs() })
    return { ok: true }
  })
  .get('/authenticate', ({ cookie, headers, status }) => {
    const sid = readSessionId(cookie[SESSION_COOKIE_NAME]?.value, headers.id)
    const session = resolveSession(sid)
    if (!session) return status(401, { error: 'unauthenticated' })
    return { address: session.address }
  })
