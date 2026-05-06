import { Hono } from 'hono'

import { toMarketplaceDomain } from '../lib/shape.ts'
import { searchByContains, searchByPrefix } from '../upstreams/ensnode.ts'

const parsePagination = (limitRaw: string | undefined, offsetRaw: string | undefined) => {
  const limit = Math.min(Math.max(Number(limitRaw ?? 20) || 20, 1), 100)
  const offset = Math.max(Number(offsetRaw ?? 0) || 0, 0)
  return { limit, offset }
}

const normalizeName = (raw: string | undefined): string => {
  if (!raw) return ''
  const trimmed = raw.trim().toLowerCase()
  return trimmed.endsWith('.eth') ? trimmed.slice(0, -'.eth'.length) : trimmed
}

export const searchRoutes = new Hono()
  .get('/search/plain', async (c) => {
    const name = normalizeName(c.req.query('name'))
    const { limit, offset } = parsePagination(c.req.query('limit'), c.req.query('offset'))
    if (!name) return c.json({ domains: [] })
    const domains = await searchByPrefix(name, limit, offset)
    return c.json({ domains: domains.map(toMarketplaceDomain) })
  })
  .get('/search/similar', async (c) => {
    // MVP: substring match instead of real semantic similarity (embedding service is dead)
    const name = normalizeName(c.req.query('name'))
    const { limit, offset } = parsePagination(c.req.query('limit'), c.req.query('offset'))
    if (!name) return c.json({ domains: [] })
    const domains = await searchByContains(name, limit, offset)
    return c.json({ domains: domains.map(toMarketplaceDomain) })
  })
