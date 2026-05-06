import { env } from '../env.ts'
import { ensCache } from '../lib/cache.ts'
import { effectiveOwner } from '../lib/shape.ts'
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

const SEARCH_BY_CONTAINS = `${DOMAIN_FRAGMENT}
query SearchByContains($needle: String!, $parentId: String!, $first: Int!, $skip: Int!) {
  domains(
    where: { name_contains: $needle, parentId: $parentId }
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
// Hard cap on the number of domains we'll keep for a single owner — the
// 5,000-name registration services exist but aren't pier's target user.
const OWNER_MAX = 5_000

const fetchAllOwnerDomains = (owner: string) =>
  cached('fetchAllOwnerDomains', { owner }, async () => {
    const lc = owner.toLowerCase()
    const all: ENSNodeDomain[] = []
    let skip = 0
    while (all.length < OWNER_MAX) {
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
      // The raw response length tells us when the upstream cursor is
      // exhausted; the filtered length doesn't (a page can be all
      // manager-only matches and look like end-of-stream when it isn't).
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
