import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

import { env } from '../env.ts'

type Session = { address: string; expiresAt: number }

const sessions = new Map<string, Session>()

const COOKIE_NAME = 'id'
const SWEEP_INTERVAL_MS = 60_000

const sweep = () => {
  const now = Date.now()
  for (const [id, s] of sessions) if (s.expiresAt <= now) sessions.delete(id)
}
const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS)
sweepTimer.unref?.()

export const createSession = (address: string): { id: string; session: Session } => {
  const id = crypto.randomUUID()
  const session: Session = { address: address.toLowerCase(), expiresAt: Date.now() + env.SESSION_TTL_MS }
  sessions.set(id, session)
  return { id, session }
}

export const getSession = (c: Context): Session | null => {
  const id = getCookie(c, COOKIE_NAME) ?? c.req.header('id')
  if (!id) return null
  const session = sessions.get(id)
  if (!session) return null
  if (Date.now() > session.expiresAt) {
    sessions.delete(id)
    return null
  }
  return session
}

export const issueSessionCookie = (c: Context, sessionId: string): void => {
  setCookie(c, COOKIE_NAME, sessionId, {
    path: '/',
    maxAge: Math.floor(env.SESSION_TTL_MS / 1000),
    httpOnly: false,
    sameSite: 'Lax',
    secure: env.NODE_ENV === 'production',
  })
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const session = getSession(c)
  if (!session) return c.json({ error: 'unauthenticated' }, 401)
  c.set('session', session)
  await next()
}
