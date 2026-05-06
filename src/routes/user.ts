import { Hono } from 'hono'

import { toMarketplaceDomain } from '../lib/shape.ts'
import { getDomainsByOwner } from '../upstreams/ensnode.ts'

const isAddress = (raw: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(raw)

export const userRoutes = new Hono().get('/domains/owner', async (c) => {
  const owner = c.req.query('owner') ?? ''
  if (!isAddress(owner)) return c.json({ domains: [] })
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 30) || 30, 1), 100)
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0)
  const domains = await getDomainsByOwner(owner, limit, offset)
  return c.json({ domains: domains.map(toMarketplaceDomain) })
})
