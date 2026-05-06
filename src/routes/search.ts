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


// ENSNode page size for the internal walker. Big enough that a typical
// limit/offset request fits in one round-trip; small enough that filtered
// searches don't pull thousands of rows when the user only asks for 20.
const WALK_PAGE = 200
// Hard cap on how far we walk for a single filter-active request. With
// extreme filters (e.g. min=max=3), some matches sit deep in alphabetical
// order — but pier isn't a search engine. Cap and accept short pages.
const WALK_MAX = 5000

// Walk the upstream `fetchPage(skip)` until we've collected at least
// `target` items that pass `filters`, ENSNode is exhausted, or we hit the
// safety cap. Returns the collected (filtered) items in upstream order.
const walkAndFilter = async (
  fetchPage: (skip: number) => Promise<ENSNodeDomain[]>,
  filters: SearchFilters,
  target: number,
): Promise<ENSNodeDomain[]> => {
  const out: ENSNodeDomain[] = []
  let skip = 0
  while (out.length < target && skip < WALK_MAX) {
    const batch = await fetchPage(skip)
    if (batch.length === 0) break
    out.push(...applyFilters(batch, filters))
    if (batch.length < WALK_PAGE) break
    skip += WALK_PAGE
  }
  return out
}

// Compose a final result page from the walked-and-filtered list, adding
// the exact match at logical position 0 when applicable. Stays
// stateless: every call recomputes the right slice for the requested
// (offset, limit), so paging through the filtered space never repeats or
// skips items the way slicing the raw upstream did.
const composePage = async (
  walked: ENSNodeDomain[],
  fullName: string | null,
  filters: SearchFilters,
  limit: number,
  offset: number,
): Promise<ENSNodeDomain[]> => {
  if (!fullName) return walked.slice(offset, offset + limit)
  const exact = await getDomainByName(fullName)
  const withoutExact = walked.filter((d) => d.name !== fullName)
  const exactPasses = exact && passesFilters(exact, filters)
  const visible = exactPasses ? [exact, ...withoutExact] : withoutExact
  return visible.slice(offset, offset + limit)
}

export const searchRoutes = new Elysia({ tags: ['search'] })
  .get(
    '/search/plain',
    async ({ query }) => {
      const name = normalizeName(query.name)
      const { limit, offset } = parsePagination(query.limit, query.offset)
      const filters = parseFilters(query)
      const fetcher = name
        ? (skip: number) => searchByPrefix(name, WALK_PAGE, skip)
        : (skip: number) => browseRecent(WALK_PAGE, skip)
      // +1 reserves a slot for the exact match we may prepend at logical
      // position 0; composePage trims it back to `limit`.
      const target = offset + limit + (name ? 1 : 0)
      const walked = await walkAndFilter(fetcher, filters, target)
      const domains = await composePage(walked, name ? `${name}.eth` : null, filters, limit, offset)
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
      const fetcher = name
        ? (skip: number) => searchByContains(name, WALK_PAGE, skip)
        : (skip: number) => browseRecent(WALK_PAGE, skip)
      const target = offset + limit + (name ? 1 : 0)
      const walked = await walkAndFilter(fetcher, filters, target)
      const domains = await composePage(walked, name ? `${name}.eth` : null, filters, limit, offset)
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
