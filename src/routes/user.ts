import { Elysia } from 'elysia'

import { SESSION_COOKIE_NAME, readSessionId, resolveSession } from '../lib/session.ts'
import { toMarketplaceDomain } from '../lib/shape.ts'
import { getDomainsByOwner } from '../upstreams/ensnode.ts'

const isAddress = (raw: string | undefined): raw is string =>
  !!raw && /^0x[0-9a-fA-F]{40}$/.test(raw)

const authed = new Elysia({ name: 'authed' }).resolve(
  { as: 'scoped' },
  ({ cookie, headers, status }) => {
    const sid = readSessionId(cookie[SESSION_COOKIE_NAME]?.value, headers.id)
    const session = resolveSession(sid)
    if (!session) return status(401, { error: 'unauthenticated' })
    return { session }
  },
)

export const userRoutes = new Elysia()
  .get('/domains/owner', async ({ query }) => {
    if (!isAddress(query.owner)) return { domains: [] }
    const limit = Math.min(Math.max(Number(query.limit ?? 30) || 30, 1), 100)
    const offset = Math.max(Number(query.offset ?? 0) || 0, 0)
    const domains = await getDomainsByOwner(query.owner, limit, offset)
    return { domains: domains.map(toMarketplaceDomain) }
  })
  .use(authed)
  // Likes — Reservoir-shaped social state, frontend already mirrors this in Redux.
  .get('/user/like', () => ({ domains: [] }))
  .post('/user/like', ({ status }) => status(204))
  .delete('/user/like', ({ status }) => status(204))
  // Cart — frontend keeps the canonical state in Redux+localStorage.
  .get('/user/cart/list', () => [])
  .post('/user/cart/modify', ({ status }) => status(204))
  .delete('/user/cart/modify', ({ status }) => status(204))
  .delete('/user/cart/clear', ({ status }) => status(204))
