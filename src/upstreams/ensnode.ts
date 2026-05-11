import { env } from '../env.ts'
import { ensCache, statsAggregationCache } from '../lib/cache.ts'
import { parseWeiBigInt, weiBigIntToApiString, weiRawToApiString } from '../lib/wei.ts'
import { type DomainStatus, effectiveOwner } from '../lib/shape.ts'
import type { ENSNodeDomain } from '../lib/types.ts'

// Returned by the page-style helpers used by the search walker.
// `raw` is the unfiltered upstream length; the walker uses it to decide
// whether ENSNode has more results, since `domains` has already been
// filtered for displayability and a single bracketed label in a full page
// would otherwise look like end-of-stream.
export type EnsPage = {
  domains: ENSNodeDomain[]
  raw: number
}

// namehash('eth') — every BaseRegistrar second-level name has this as its
// parent. Filtering by parentId at the query level eliminates .base.eth /
// .linea.eth / subdomains in one shot; ENSNode confirms support via the
// Domain_filter `parentId` input.
const ETH_NODE = '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae'

// Domains for non-decodable labels come back as "[<hex>].eth" with a
// bracketed labelName. The frontend can't render or operate on those
// (registration, getDomainHexId, Reservoir lookups all assume a normal
// label), so drop them before shaping.
const isBaseRegistrarDisplayable = (d: ENSNodeDomain): boolean => {
  if (!d.name || !d.name.endsWith('.eth')) return false
  if (d.name.split('.').length !== 2) return false
  const label = d.labelName ?? d.name.slice(0, -'.eth'.length)
  if (!label || label.startsWith('[')) return false
  return true
}

const filterDisplayable = (domains: ENSNodeDomain[]): ENSNodeDomain[] =>
  domains.filter(isBaseRegistrarDisplayable)

const DOMAIN_FRAGMENT = `
fragment DomainFields on Domain {
  id
  name
  labelName
  owner { id }
  wrappedOwner { id }
  registrant { id }
  expiryDate
  createdAt
  registration { registrationDate expiryDate }
}`

type GraphQLResponse<T> = { data?: T; errors?: { message: string }[] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const body = JSON.stringify({ query, variables })
  const headers = { 'content-type': 'application/json', accept: 'application/json' }

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response
    try {
      res = await fetch(env.ENSNODE_URL, { method: 'POST', headers, body })
    } catch (err) {
      if (attempt === 0) {
        await sleep(250)
        continue
      }
      throw err
    }
    if (res.status >= 500) {
      const text = await res.text()
      if (attempt === 0) {
        await sleep(250)
        continue
      }
      throw new Error(`ENSNode ${res.status}: ${text.slice(0, 200)}`)
    }
    if (!res.ok) {
      // 4xx — caller bug, don't retry.
      throw new Error(`ENSNode ${res.status}: ${(await res.text()).slice(0, 200)}`)
    }
    const json = (await res.json()) as GraphQLResponse<T>
    if (json.errors?.length) {
      throw new Error(`ENSNode GraphQL: ${json.errors.map((e) => e.message).join('; ')}`)
    }
    if (!json.data) throw new Error('ENSNode: empty data')
    return json.data
  }
  throw new Error('ENSNode: unreachable')
}

const cached = <T>(name: string, args: unknown, fn: () => Promise<T>): Promise<T> =>
  ensCache.getOrSet(`${name}:${JSON.stringify(args)}`, fn) as Promise<T>

const SEARCH_BY_PREFIX = `${DOMAIN_FRAGMENT}
query SearchByPrefix($prefix: String!, $parentId: String!, $first: Int!, $skip: Int!) {
  domains(
    where: { name_starts_with: $prefix, parentId: $parentId }
    orderBy: name
    orderDirection: asc
    first: $first
    skip: $skip
  ) { ...DomainFields }
}`

export const searchByPrefix = (prefix: string, first: number, skip: number): Promise<EnsPage> =>
  cached('searchByPrefix', { prefix, first, skip }, async () => {
    const data = await gql<{ domains: ENSNodeDomain[] }>(SEARCH_BY_PREFIX, {
      prefix,
      parentId: ETH_NODE,
      first,
      skip,
    })
    return { domains: filterDisplayable(data.domains), raw: data.domains.length }
  }) as Promise<EnsPage>

// Domain.expiryDate offsets relative to `now` (in seconds) for each
// lifecycle bucket. ENSNode lets us filter by Domain.expiryDate but not by
// Registration.expiryDate (no `registration_:` nested filter), so for
// unwrapped names where Domain.expiryDate = registration.expiryDate + 90d
// these match the boundaries used by domainStatus(). For wrapped names the
// upstream filter is approximate; the walker's post-filter (domainStatus)
// fixes any disagreement, but the upstream narrowing is still vastly more
// useful than browseRecent for empty-name + status_type searches.
const STATUS_EXPIRY_DELTAS: Record<DomainStatus, { gt?: number; lt?: number }> = {
  registered: { gt: 90 * 86_400 },
  grace: { gt: 0, lt: 90 * 86_400 },
  premium: { gt: -21 * 86_400, lt: 0 },
  new: { gt: -51 * 86_400, lt: -21 * 86_400 },
  previously_owned: { lt: -51 * 86_400 },
}

// Compute the union of the lifecycle intervals as a single contiguous
// range. All our user-facing status mappings (status_type=premium,
// status_type=previously_owned → ['previously_owned', 'new'], …) produce
// adjacent intervals, so the union is exact. ENSNode's `or:` filter is
// broken for range conditions in 2026 (verified empirically), so we can't
// fan out — anyone introducing a non-contiguous mapping needs to fall
// back to multi-query merging.
export const expiryRangeFor = (
  statuses: DomainStatus[],
): { gt?: number; lt?: number } => {
  let lo = Infinity
  let hi = -Infinity
  let lowerInf = false
  let upperInf = false
  for (const s of statuses) {
    const r = STATUS_EXPIRY_DELTAS[s]
    if (r.gt === undefined) lowerInf = true
    else if (r.gt < lo) lo = r.gt
    if (r.lt === undefined) upperInf = true
    else if (r.lt > hi) hi = r.lt
  }
  return {
    gt: lowerInf || lo === Infinity ? undefined : lo,
    lt: upperInf || hi === -Infinity ? undefined : hi,
  }
}

// Round `now` to a 30-second bucket so successive page requests for the
// same status share a cache key — matches the ensCache TTL.
const bucketedNow = (): number => Math.floor(Date.now() / 30_000) * 30

const BROWSE_BY_EXPIRY = `${DOMAIN_FRAGMENT}
query BrowseByExpiry($where: Domain_filter!, $first: Int!, $skip: Int!) {
  domains(
    where: $where
    orderBy: expiryDate
    orderDirection: desc
    first: $first
    skip: $skip
  ) { ...DomainFields }
}`

export const browseByStatus = (
  statuses: DomainStatus[],
  first: number,
  skip: number,
): Promise<EnsPage> => {
  const now = bucketedNow()
  const delta = expiryRangeFor(statuses)
  const range = {
    gt: delta.gt !== undefined ? now + delta.gt : undefined,
    lt: delta.lt !== undefined ? now + delta.lt : undefined,
  }
  return cached('browseByStatus', { range, first, skip }, async () => {
    const where: Record<string, unknown> = { parentId: ETH_NODE }
    if (range.gt !== undefined) where.expiryDate_gt = range.gt
    if (range.lt !== undefined) where.expiryDate_lt = range.lt
    const data = await gql<{ domains: ENSNodeDomain[] }>(BROWSE_BY_EXPIRY, {
      where,
      first,
      skip,
    })
    return { domains: filterDisplayable(data.domains), raw: data.domains.length }
  }) as Promise<EnsPage>
}

// Default-browse query: no name filter, ordered by createdAt desc so the
// frontend's "open the marketplace with no search term" view renders recent
// registrations instead of an empty page.
const BROWSE_RECENT = `${DOMAIN_FRAGMENT}
query BrowseRecent($parentId: String!, $first: Int!, $skip: Int!) {
  domains(
    where: { parentId: $parentId }
    orderBy: createdAt
    orderDirection: desc
    first: $first
    skip: $skip
  ) { ...DomainFields }
}`

export const browseRecent = (first: number, skip: number): Promise<EnsPage> =>
  cached('browseRecent', { first, skip }, async () => {
    const data = await gql<{ domains: ENSNodeDomain[] }>(BROWSE_RECENT, {
      parentId: ETH_NODE,
      first,
      skip,
    })
    return { domains: filterDisplayable(data.domains), raw: data.domains.length }
  }) as Promise<EnsPage>

// Match on the label (the part before .eth), not the full name — otherwise
// `name=eth` would match every BaseRegistrar 2LD because they all end in
// ".eth". labelName_contains also keeps results limited to the label space
// the frontend actually operates in.
const SEARCH_BY_CONTAINS = `${DOMAIN_FRAGMENT}
query SearchByContains($needle: String!, $parentId: String!, $first: Int!, $skip: Int!) {
  domains(
    where: { labelName_contains: $needle, parentId: $parentId }
    orderBy: name
    orderDirection: asc
    first: $first
    skip: $skip
  ) { ...DomainFields }
}`

export const searchByContains = (needle: string, first: number, skip: number): Promise<EnsPage> =>
  cached('searchByContains', { needle, first, skip }, async () => {
    const data = await gql<{ domains: ENSNodeDomain[] }>(SEARCH_BY_CONTAINS, {
      needle,
      parentId: ETH_NODE,
      first,
      skip,
    })
    return { domains: filterDisplayable(data.domains), raw: data.domains.length }
  }) as Promise<EnsPage>

// A user's portfolio can hold a .eth 2LD via three different ENSNode fields:
//   - wrappedOwnerId : wrapped names (registry owner is the NameWrapper)
//   - registrantId   : BaseRegistrar NFT holder (manager may be delegated)
//   - ownerId        : registry manager (only authoritative if not delegated)
// Filtering on any single one drops legitimately-owned names, so OR them.
const GET_DOMAINS_BY_OWNER = `${DOMAIN_FRAGMENT}
query GetDomainsByOwner($owner: String!, $parentId: String!, $first: Int!, $skip: Int!) {
  domains(
    where: {
      parentId: $parentId,
      or: [
        { ownerId: $owner },
        { wrappedOwnerId: $owner },
        { registrantId: $owner }
      ]
    }
    orderBy: name
    orderDirection: asc
    first: $first
    skip: $skip
  ) { ...DomainFields }
}`

// ENSNode page size for the internal walk over an owner's domains. Big
// enough that most portfolios fit in one round-trip; manager-only matches
// and bracketed labels filter out before any (skip, first) slicing happens.
const OWNER_PAGE = 200
// Hard cap on how many *raw* upstream rows we'll scan for one owner. The
// guard has to be on the cursor (skip) rather than the collected length:
// a wallet that's the registry manager for thousands of names but the NFT
// holder for none produces filter-empty pages that never advance
// `all.length`, so a length-based cap walks unbounded ENSNode pages.
const OWNER_WALK_MAX = 10_000
// Soft cap on retained domains — pier isn't targeting addresses that hold
// >5k names and the response size needs a ceiling.
const OWNER_KEEP_MAX = 5_000

const fetchAllOwnerDomains = (owner: string) =>
  cached('fetchAllOwnerDomains', { owner }, async () => {
    const lc = owner.toLowerCase()
    const all: ENSNodeDomain[] = []
    let skip = 0
    while (skip < OWNER_WALK_MAX && all.length < OWNER_KEEP_MAX) {
      const data = await gql<{ domains: ENSNodeDomain[] }>(GET_DOMAINS_BY_OWNER, {
        owner: lc,
        parentId: ETH_NODE,
        first: OWNER_PAGE,
        skip,
      })
      const batch = filterDisplayable(data.domains).filter(
        (d) => effectiveOwner(d) === lc,
      )
      all.push(...batch)
      // Raw upstream length is the right exhaustion signal — a page can be
      // entirely manager-only matches (filtered length 0) without meaning
      // ENSNode has nothing more.
      if (data.domains.length < OWNER_PAGE) break
      skip += OWNER_PAGE
    }
    return all
  }) as Promise<ENSNodeDomain[]>

// Slice locally so manager-only or bracketed entries can't shrink any
// individual page below the requested `first`.
export const getDomainsByOwner = async (
  owner: string,
  first: number,
  skip: number,
): Promise<ENSNodeDomain[]> => {
  const all = await fetchAllOwnerDomains(owner)
  return all.slice(skip, skip + first)
}

const GET_EXPIRY_DATES = `${DOMAIN_FRAGMENT}
query GetExpiryDates($names: [String!]!) {
  domains(where: { name_in: $names }, first: 1000) { ...DomainFields }
}`

export const getExpiryDates = (names: string[]) =>
  cached('getExpiryDates', { names: [...names].sort() }, async () => {
    const data = await gql<{ domains: ENSNodeDomain[] }>(GET_EXPIRY_DATES, { names })
    return data.domains
  })

const GET_DOMAIN_BY_NAME = `${DOMAIN_FRAGMENT}
query GetDomainByName($name: String!) {
  domains(where: { name: $name }, first: 1) { ...DomainFields }
}`

export const getDomainByName = (name: string): Promise<ENSNodeDomain | null> =>
  cached('getDomainByName', { name }, async () => {
    const data = await gql<{ domains: ENSNodeDomain[] }>(GET_DOMAIN_BY_NAME, { name })
    return filterDisplayable(data.domains)[0] ?? null
  })

// ─── Ethereum mainnet .eth 2LD registration metrics (ENS subgraph via ENSNode) ───

type RegistrationDomainSlice = {
  name: string | null
  labelName: string | null
  parent: { id: string } | null
}

type RegistrationRow = {
  cost: string | null
  registrationDate: string
  domain: RegistrationDomainSlice | null
}

/** Same parent filter as `Domain.parentId` search — direct children of `eth`. */
const isEthTwoLdRegistration = (r: RegistrationRow): boolean => {
  const d = r.domain
  if (!d?.parent?.id) return false
  if (d.parent.id.toLowerCase() !== ETH_NODE.toLowerCase()) return false
  const name = d.name
  if (!name || !name.endsWith('.eth')) return false
  if (name.split('.').length !== 2) return false
  const label = d.labelName ?? name.slice(0, -'.eth'.length)
  if (!label || label.startsWith('[')) return false
  return true
}

const Q_RECENT_REGS = `
query PierRecentRegs($first: Int!, $skip: Int!) {
  registrations(
    orderBy: registrationDate
    orderDirection: desc
    first: $first
    skip: $skip
  ) {
    cost
    registrationDate
    domain {
      name
      labelName
      parent { id }
    }
  }
}`

const Q_COST_ORDERED = `
query PierCostOrderedRegs($since: BigInt!, $first: Int!, $skip: Int!) {
  registrations(
    where: { registrationDate_gte: $since }
    orderBy: cost
    orderDirection: desc
    first: $first
    skip: $skip
  ) {
    cost
    registrationDate
    domain {
      name
      labelName
      parent { id }
    }
  }
}`

const Q_VOL_REGS = `
query PierVolRegs($since: BigInt!, $first: Int!, $skip: Int!) {
  registrations(
    where: { registrationDate_gte: $since }
    orderBy: registrationDate
    orderDirection: asc
    first: $first
    skip: $skip
  ) {
    cost
    registrationDate
    domain {
      name
      labelName
      parent { id }
    }
  }
}`

const PAGE = 100
const MAX_LAST_PAGES = 15
const MAX_HIGH_PAGES = 10
const MAX_VOL_PAGES = 40

export type EthRegistrationStats = {
  reg_volume_day: string
  last_reg: string
  last_reg_domain_name: string
  highest_reg: string
  highest_reg_domain_name: string
}

async function latestEthTwoLdRegistration(): Promise<{ wei: string; name: string }> {
  for (let page = 0; page < MAX_LAST_PAGES; page++) {
    const data = await gql<{ registrations: RegistrationRow[] }>(Q_RECENT_REGS, {
      first: PAGE,
      skip: page * PAGE,
    })
    const hit = data.registrations.find(isEthTwoLdRegistration)
    if (hit) {
      return {
        wei: weiRawToApiString(hit.cost),
        name: hit.domain?.name ?? '',
      }
    }
    if (data.registrations.length < PAGE) break
  }
  return { wei: '0', name: '' }
}

async function highestEthTwoLdSince(sinceSec: number): Promise<{ wei: string; name: string }> {
  const since = String(sinceSec)
  for (let page = 0; page < MAX_HIGH_PAGES; page++) {
    const data = await gql<{ registrations: RegistrationRow[] }>(Q_COST_ORDERED, {
      since,
      first: PAGE,
      skip: page * PAGE,
    })
    const hit = data.registrations.find(isEthTwoLdRegistration)
    if (hit) {
      return {
        wei: weiRawToApiString(hit.cost),
        name: hit.domain?.name ?? '',
      }
    }
    if (data.registrations.length < PAGE) break
  }
  return { wei: '0', name: '' }
}

async function ethTwoLdVolumeWeiSince(sinceSec: number): Promise<bigint> {
  const since = String(sinceSec)
  let sum = 0n
  for (let page = 0; page < MAX_VOL_PAGES; page++) {
    const data = await gql<{ registrations: RegistrationRow[] }>(Q_VOL_REGS, {
      since,
      first: PAGE,
      skip: page * PAGE,
    })
    for (const r of data.registrations) {
      if (!isEthTwoLdRegistration(r)) continue
      sum += parseWeiBigInt(r.cost)
    }
    if (data.registrations.length < PAGE) break
  }
  return sum
}

/** Rolling 24h volume + latest/maxes for Ethereum `*.eth` 2LDs (excludes L2 TLDs like `.base.eth`). Cached 60s via `statsAggregationCache` (not `ensCache` — 30s TTL would expire halfway through a “minute bucket”). */
export const fetchEthRegistrationStats = (): Promise<EthRegistrationStats> =>
  statsAggregationCache.getOrSet('fetchEthRegistrationStats', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const dayStart = nowSec - 86_400
    const monthStart = nowSec - 30 * 86_400

    const [last, hi, volWei] = await Promise.all([
      latestEthTwoLdRegistration(),
      highestEthTwoLdSince(monthStart),
      ethTwoLdVolumeWeiSince(dayStart),
    ])

    return {
      reg_volume_day: weiBigIntToApiString(volWei),
      last_reg: last.wei,
      last_reg_domain_name: last.name,
      highest_reg: hi.wei,
      highest_reg_domain_name: hi.name,
    }
  }) as Promise<EthRegistrationStats>
