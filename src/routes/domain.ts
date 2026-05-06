import { Elysia } from 'elysia'

import { TCategoriesResponse, TDomainsListQuery, TExpiresResponse } from '../lib/schemas.ts'
import { toCategoriesEntry, toExpiresEntry } from '../lib/shape.ts'
import { getExpiryDates } from '../upstreams/ensnode.ts'

const parseDomains = (raw: string | undefined): string[] => {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export const domainRoutes = new Elysia({ tags: ['domain'] })
  .get(
    '/info/domain/categories',
    ({ query }) => {
      const requested = parseDomains(query.domains)
      return { domains: requested.map(toCategoriesEntry) }
    },
    {
      query: TDomainsListQuery,
      response: TCategoriesResponse,
      detail: {
        summary: 'Domain category metadata (stubbed: empty categories)',
      },
    },
  )
  .get(
    '/info/domain/expires',
    async ({ query }) => {
      const requested = parseDomains(query.domains)
      if (requested.length === 0) return { domains: [] }
      // ENSNode keys by ENS name. The frontend may pass either ENS names or hex tokenIds;
      // we look up by name and emit `expires: 0` for the rest.
      const names = requested.filter((d) => d.includes('.'))
      const fetched = names.length > 0 ? await getExpiryDates(names) : []
      const byName = new Map(fetched.map((d) => [d.name ?? '', d]))
      return {
        domains: requested.map((d) => toExpiresEntry(d, byName.get(d))),
      }
    },
    {
      query: TDomainsListQuery,
      response: TExpiresResponse,
      detail: {
        summary: 'Expiry timestamp lookup; tokenIds yield expires:0',
      },
    },
  )
