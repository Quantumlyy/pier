import { Elysia } from 'elysia'

import { TDomainsResponse, TRollQuery, TSearchQuery } from '../lib/schemas.ts'
import { toMarketplaceDomain } from '../lib/shape.ts'
import {
  browseRecent,
  getExpiryDates,
  searchByContains,
  searchByPrefix,
} from '../upstreams/ensnode.ts'

const ROLL_POOL = [
  'vitalik.eth', 'nick.eth', 'brantly.eth', 'sassal.eth', 'cory.eth',
  'avsa.eth', 'matoken.eth', 'griff.eth', 'jefflau.eth', 'taytems.eth',
  'noun.eth', 'punks.eth', 'cypherpunk.eth', 'crypto.eth', 'wallet.eth',
  'metamask.eth', 'rainbow.eth', 'opensea.eth', 'foundation.eth', 'ethereum.eth',
]

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

export const searchRoutes = new Elysia({ tags: ['search'] })
  .get(
    '/search/plain',
    async ({ query }) => {
      const name = normalizeName(query.name)
      const { limit, offset } = parsePagination(query.limit, query.offset)
      // Empty name = the frontend's default marketplace / filter-only browse;
      // return a recent-first page rather than nothing.
      const domains = name
        ? await searchByPrefix(name, limit, offset)
        : await browseRecent(limit, offset)
      return { domains: domains.map(toMarketplaceDomain) }
    },
    {
      query: TSearchQuery,
      response: TDomainsResponse,
      detail: { summary: 'Prefix-match search; empty name returns recent registrations' },
    },
  )
  .get(
    '/search/similar',
    async ({ query }) => {
      // MVP: substring match instead of real semantic similarity (embedding service is dead)
      const name = normalizeName(query.name)
      const { limit, offset } = parsePagination(query.limit, query.offset)
      const domains = name
        ? await searchByContains(name, limit, offset)
        : await browseRecent(limit, offset)
      return { domains: domains.map(toMarketplaceDomain) }
    },
    {
      query: TSearchQuery,
      response: TDomainsResponse,
      detail: { summary: 'Substring match via ENSNode (MVP — no embeddings)' },
    },
  )
  .get(
    '/roll',
    async ({ query }) => {
      const limit = Math.min(Math.max(Number(query.limit ?? 1) || 1, 1), ROLL_POOL.length)
      const fetched = await getExpiryDates(ROLL_POOL)
      const byName = new Map(fetched.map((d) => [d.name ?? '', d]))
      const shuffled = [...ROLL_POOL].sort(() => Math.random() - 0.5).slice(0, limit)
      const domains = shuffled
        .map((name) => byName.get(name))
        .filter((d): d is NonNullable<typeof d> => d != null)
        .map(toMarketplaceDomain)
      return { domains }
    },
    {
      query: TRollQuery,
      response: TDomainsResponse,
      detail: { summary: 'Random pick from a hardcoded pool of well-known names' },
    },
  )
