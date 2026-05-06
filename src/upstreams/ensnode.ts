import { env } from '../env.ts'
import { ensCache } from '../lib/cache.ts'
import { effectiveOwner } from '../lib/shape.ts'
import type { ENSNodeDomain } from '../lib/types.ts'

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

export const searchByPrefix = (prefix: string, first: number, skip: number) =>
  cached('searchByPrefix', { prefix, first, skip }, async () => {
    const data = await gql<{ domains: ENSNodeDomain[] }>(SEARCH_BY_PREFIX, {
      prefix,
      parentId: ETH_NODE,
      first,
      skip,
    })
    return filterDisplayable(data.domains)
  })

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

export const browseRecent = (first: number, skip: number) =>
  cached('browseRecent', { first, skip }, async () => {
    const data = await gql<{ domains: ENSNodeDomain[] }>(BROWSE_RECENT, {
      parentId: ETH_NODE,
      first,
      skip,
    })
    return filterDisplayable(data.domains)
  })

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

export const searchByContains = (needle: string, first: number, skip: number) =>
  cached('searchByContains', { needle, first, skip }, async () => {
    const data = await gql<{ domains: ENSNodeDomain[] }>(SEARCH_BY_CONTAINS, {
      needle,
      parentId: ETH_NODE,
      first,
      skip,
    })
    return filterDisplayable(data.domains)
  })

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

export const getDomainsByOwner = (owner: string, first: number, skip: number) =>
  cached('getDomainsByOwner', { owner, first, skip }, async () => {
    const lc = owner.toLowerCase()
    const data = await gql<{ domains: ENSNodeDomain[] }>(GET_DOMAINS_BY_OWNER, {
      owner: lc,
      parentId: ETH_NODE,
      first,
      skip,
    })
    // The OR includes `ownerId` to catch domains with no Registration entity,
    // but for normal .eth 2LDs that match also pulls in names where the
    // queried address is just the registry manager / delegate. Keep only
    // results whose effective owner (wrappedOwner > registrant > owner) is
    // the queried address — anything else belongs in someone else's portfolio.
    return filterDisplayable(data.domains).filter((d) => effectiveOwner(d) === lc)
  })

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
