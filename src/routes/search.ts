import { Elysia } from 'elysia'

import { TDomainsResponse, TRollQuery, TSearchQuery } from '../lib/schemas.ts'
import { toMarketplaceDomain } from '../lib/shape.ts'
import type { ENSNodeDomain } from '../lib/types.ts'
import {
  browseRecent,
  getDomainByName,
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

// We honor the filters we can derive from the ENSNode shape:
//   - min_domain_length / max_domain_length: label-character count
//   - name_symbols_type: comma-separated subset of {letters, numbers, emojis}
// Reservoir-dependent filters (price ranges, has_offers_selector,
// search_terms/categories, listed-status sorts, most_favorited / price-based
// sorts) are silently ignored — none of that data exists on this side.
type SearchFilters = {
  minLength: number | undefined
  maxLength: number | undefined
  symbolTypes: Set<'letters' | 'numbers' | 'emojis'>
}

const parseFilters = (q: Record<string, string | undefined>): SearchFilters => {
  const parseLen = (raw: string | undefined): number | undefined => {
    if (!raw) return undefined
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }
  const symbolTypes = new Set<'letters' | 'numbers' | 'emojis'>()
  for (const tok of (q.name_symbols_type ?? '').toLowerCase().split(',')) {
    const t = tok.trim()
    if (t === 'letters' || t === 'numbers' || t === 'emojis') symbolTypes.add(t)
  }
  return {
    minLength: parseLen(q.min_domain_length),
    maxLength: parseLen(q.max_domain_length),
    symbolTypes,
  }
}

const labelOf = (d: ENSNodeDomain): string =>
  d.labelName && d.labelName.length > 0
    ? d.labelName
    : (d.name ?? '').replace(/\.eth$/, '')

// `Array.from(label)` iterates by UTF-16 code points, splitting surrogate
// pairs (= emoji) into individual elements; that's what jetty's lengths
// effectively reflected too.
const labelLength = (label: string): number => Array.from(label).length

const LETTERS_ONLY = /^[a-z]+$/i
const NUMBERS_ONLY = /^[0-9]+$/
// Coarse emoji detector: anything in the supplementary plane plus the
// common BMP ranges used by emojis. Good enough for the type filter.
const HAS_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}]/u

const symbolMatches = (label: string, types: SearchFilters['symbolTypes']): boolean => {
  if (types.size === 0) return true
  if (types.has('letters') && LETTERS_ONLY.test(label)) return true
  if (types.has('numbers') && NUMBERS_ONLY.test(label)) return true
  if (types.has('emojis') && HAS_EMOJI.test(label)) return true
  return false
}

const passesFilters = (d: ENSNodeDomain, f: SearchFilters): boolean => {
  const label = labelOf(d)
  const len = labelLength(label)
  if (f.minLength !== undefined && len < f.minLength) return false
  if (f.maxLength !== undefined && len > f.maxLength) return false
  if (!symbolMatches(label, f.symbolTypes)) return false
  return true
}

const filtersActive = (f: SearchFilters): boolean =>
  f.minLength !== undefined || f.maxLength !== undefined || f.symbolTypes.size > 0

const applyFilters = (domains: ENSNodeDomain[], f: SearchFilters): ENSNodeDomain[] => {
  if (!filtersActive(f)) return domains
  return domains.filter((d) => passesFilters(d, f))
}

// When filters are active we over-fetch and slice locally so a single page
// of restrictive results (e.g. 3-character labels) doesn't come back empty.
// Capped to keep ENSNode happy.
const upstreamLimit = (limit: number, f: SearchFilters): number =>
  filtersActive(f) ? Math.min(Math.max(limit * 10, 100), 1000) : limit

// `name_starts_with` ordered alphabetically puts every "${name}-..." domain
// (hyphen 0x2D < period 0x2E) before "${name}.eth", so the exact registered
// name routinely falls off the first page. The frontend reads its absence as
// "unregistered" and offers to register a name someone already owns.
//
// On every page, drop the exact match from the prefix results. On page 0
// only, prepend it. That gives the exact match a deterministic position 0
// without losing or duplicating the alphabetical-tail item across pages —
// page 0 may exceed `limit` by one (frontend handles variable page sizes
// via pageParam + 1), and the caller is free to slice if needed.
const withExactPrepended = async (
  fetcher: () => Promise<ENSNodeDomain[]>,
  fullName: string,
  offset: number,
): Promise<ENSNodeDomain[]> => {
  const [exact, page] = await Promise.all([getDomainByName(fullName), fetcher()])
  if (!exact) return page
  const filtered = page.filter((d) => d.name !== fullName)
  return offset === 0 ? [exact, ...filtered] : filtered
}

export const searchRoutes = new Elysia({ tags: ['search'] })
  .get(
    '/search/plain',
    async ({ query }) => {
      const name = normalizeName(query.name)
      const { limit, offset } = parsePagination(query.limit, query.offset)
      const filters = parseFilters(query)
      const fetchLimit = upstreamLimit(limit, filters)
      const raw = name
        ? await withExactPrepended(
            () => searchByPrefix(name, fetchLimit, offset),
            `${name}.eth`,
            offset,
          )
        : await browseRecent(fetchLimit, offset)
      // Only slice when filters consumed excess from over-fetch; for the
      // unfiltered path, let page 0 exceed `limit` by one when the exact
      // match is prepended (frontend handles variable page sizes).
      const filtered = applyFilters(raw, filters)
      const domains = filtersActive(filters) ? filtered.slice(0, limit) : filtered
      return { domains: domains.map(toMarketplaceDomain) }
    },
    {
      query: TSearchQuery,
      response: TDomainsResponse,
      detail: {
        summary:
          'Prefix-match search with the exact match prepended; empty name returns recent registrations',
      },
    },
  )
  .get(
    '/search/similar',
    async ({ query }) => {
      // MVP: substring match instead of real semantic similarity (embedding service is dead)
      const name = normalizeName(query.name)
      const { limit, offset } = parsePagination(query.limit, query.offset)
      const filters = parseFilters(query)
      const fetchLimit = upstreamLimit(limit, filters)
      const raw = name
        ? await withExactPrepended(
            () => searchByContains(name, fetchLimit, offset),
            `${name}.eth`,
            offset,
          )
        : await browseRecent(fetchLimit, offset)
      // Only slice when filters consumed excess from over-fetch; for the
      // unfiltered path, let page 0 exceed `limit` by one when the exact
      // match is prepended (frontend handles variable page sizes).
      const filtered = applyFilters(raw, filters)
      const domains = filtersActive(filters) ? filtered.slice(0, limit) : filtered
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
