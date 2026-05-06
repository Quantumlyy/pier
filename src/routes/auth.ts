import { Elysia, t } from 'elysia'
import { SiweMessage } from 'siwe'

import { allowedDomains } from '../env.ts'
import {
  TAuthOk,
  TError,
  TVerifyBody,
  TVerifyOk,
} from '../lib/schemas.ts'
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

export const authRoutes = new Elysia({ tags: ['auth'] })
  .get(
    '/nonce',
    ({ cookie, headers, set }) => {
      // RainbowKit's signOut adapter calls GET /nonce expecting it to wipe the
      // existing session — jetty did this as a side effect of issuing a fresh
      // nonce, and the frontend explicitly comments on the behavior.
      const sid = readSessionId(cookie[SESSION_COOKIE_NAME]?.value, headers.id)
      dropSession(sid)
      cookie[SESSION_COOKIE_NAME]?.remove()
      set.headers['content-type'] = 'text/plain; charset=utf-8'
      return issueNonce()
    },
    {
      response: t.String({ description: 'Fresh SIWE nonce; also wipes any existing session' }),
      detail: { summary: 'Issue a SIWE nonce and clear the active session' },
    },
  )
  .post(
    '/verify',
    async ({ body, cookie, status }) => {
      let parsed: SiweMessage
      try {
        parsed = new SiweMessage(body.message)
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
        .verify({ signature: body.signature, nonce: parsed.nonce, domain: parsed.domain })
        .catch((err) => ({ success: false as const, error: { type: (err as Error).message } }))
      if (!result.success) {
        return status(422, { error: result.error?.type ?? 'signature verification failed' })
      }
      const { id } = createSession(parsed.address)
      cookie[SESSION_COOKIE_NAME]?.set({ value: id, ...sessionCookieAttrs() })
      return { ok: true as const }
    },
    {
      body: TVerifyBody,
      response: { 200: TVerifyOk, 400: TError, 422: TError },
      detail: { summary: 'Verify a signed SIWE message and start a session' },
    },
  )
  .get(
    '/authenticate',
    ({ cookie, headers, status }) => {
      const sid = readSessionId(cookie[SESSION_COOKIE_NAME]?.value, headers.id)
      const session = resolveSession(sid)
      if (!session) return status(401, { error: 'unauthenticated' })
      return { address: session.address }
    },
    {
      response: { 200: TAuthOk, 401: TError },
      detail: { summary: 'Return the address of the active session, or 401' },
    },
  )
