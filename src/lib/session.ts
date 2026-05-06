import { generateNonce } from 'siwe'

import { env } from '../env.ts'

type Session = { address: string; expiresAt: number }

const sessions = new Map<string, Session>()
const nonces = new Map<string, number>()

const SWEEP_INTERVAL_MS = 60_000
const NONCE_TTL_MS = 5 * 60_000

const sweep = () => {
  const now = Date.now()
  for (const [id, s] of sessions) if (s.expiresAt <= now) sessions.delete(id)
  for (const [n, expiresAt] of nonces) if (expiresAt <= now) nonces.delete(n)
}
const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS)
sweepTimer.unref?.()

export const issueNonce = (): string => {
  const nonce = generateNonce()
  nonces.set(nonce, Date.now() + NONCE_TTL_MS)
  return nonce
}

export const consumeNonce = (nonce: string): boolean => {
  const expiresAt = nonces.get(nonce)
  if (expiresAt === undefined) return false
  nonces.delete(nonce)
  return Date.now() <= expiresAt
}

export const createSession = (address: string): { id: string; session: Session } => {
  const id = crypto.randomUUID()
  const session: Session = {
    address: address.toLowerCase(),
    expiresAt: Date.now() + env.SESSION_TTL_MS,
  }
  sessions.set(id, session)
  return { id, session }
}

export const resolveSession = (sessionId: string | undefined | null): Session | null => {
  if (!sessionId) return null
  const session = sessions.get(sessionId)
  if (!session) return null
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId)
    return null
  }
  return session
}

export const dropSession = (sessionId: string | undefined | null): void => {
  if (sessionId) sessions.delete(sessionId)
}

export const sessionCookieAttrs = () => ({
  path: '/',
  maxAge: Math.floor(env.SESSION_TTL_MS / 1000),
  httpOnly: false,
  sameSite: 'lax' as const,
  secure: env.NODE_ENV === 'production',
})

export const SESSION_COOKIE_NAME = 'id'

export const readSessionId = (
  cookieValue: unknown,
  headerValue: unknown,
): string | undefined => {
  if (typeof cookieValue === 'string' && cookieValue.length > 0) return cookieValue
  if (typeof headerValue === 'string' && headerValue.length > 0) return headerValue
  return undefined
}

export type { Session }
