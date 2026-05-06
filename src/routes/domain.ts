import { Hono } from 'hono'

import { toCategoriesEntry, toExpiresEntry } from '../lib/shape.ts'
import { getExpiryDates } from '../upstreams/ensnode.ts'

const parseDomains = (raw: string | undefined): string[] => {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export const domainRoutes = new Hono()
  .get('/info/domain/categories', (c) => {
    const requested = parseDomains(c.req.query('domains'))
    return c.json({ domains: requested.map(toCategoriesEntry) })
  })
  .get('/info/domain/expires', async (c) => {
    const requested = parseDomains(c.req.query('domains'))
    if (requested.length === 0) return c.json({ domains: [] })
    // ENSNode keys by ENS name. The frontend may pass either ENS names or hex tokenIds;
    // we look up by name and emit `expires: 0` for the rest.
    const names = requested.filter((d) => d.includes('.'))
    const fetched = names.length > 0 ? await getExpiryDates(names) : []
    const byName = new Map(fetched.map((d) => [d.name ?? '', d]))
    return c.json({
      domains: requested.map((d) => toExpiresEntry(d, byName.get(d))),
    })
  })
