import { Hono } from 'hono'

import { requireAuth } from '../lib/session.ts'
import { toMarketplaceDomain } from '../lib/shape.ts'
import { getDomainsByOwner } from '../upstreams/ensnode.ts'

const isAddress = (raw: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(raw)

export const userRoutes = new Hono()
  .get('/domains/owner', async (c) => {
    const owner = c.req.query('owner') ?? ''
    if (!isAddress(owner)) return c.json({ domains: [] })
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 30) || 30, 1), 100)
    const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0)
    const domains = await getDomainsByOwner(owner, limit, offset)
    return c.json({ domains: domains.map(toMarketplaceDomain) })
  })
  // Likes — Reservoir-shaped social state, frontend already mirrors this in Redux.
  .get('/user/like', requireAuth, (c) => c.json({ domains: [] }))
  .post('/user/like', requireAuth, (c) => c.body(null, 204))
  .delete('/user/like', requireAuth, (c) => c.body(null, 204))
  // Cart — frontend keeps the canonical state in Redux+localStorage.
  .get('/user/cart/list', requireAuth, (c) => c.json([]))
  .post('/user/cart/modify', requireAuth, (c) => c.body(null, 204))
  .delete('/user/cart/modify', requireAuth, (c) => c.body(null, 204))
  .delete('/user/cart/clear', requireAuth, (c) => c.body(null, 204))
