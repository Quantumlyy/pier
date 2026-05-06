import { env } from '../env.ts'
import { ensCache } from '../lib/cache.ts'
import type { ENSNodeDomain } from '../lib/types.ts'

const DOMAIN_FRAGMENT = `
fragment DomainFields on Domain {
  id
  name
  labelName
  owner { id }
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
query SearchByPrefix($prefix: String!, $first: Int!, $skip: Int!) {
  domains(
    where: { name_starts_with: $prefix }
    orderBy: name
    orderDirection: asc
    first: $first
    skip: $skip
  ) { ...DomainFields }
}`

export const searchByPrefix = (prefix: string, first: number, skip: number) =>
  cached('searchByPrefix', { prefix, first, skip }, async () => {
    const data = await gql<{ domains: ENSNodeDomain[] }>(SEARCH_BY_PREFIX, { prefix, first, skip })
    return data.domains
  })

const SEARCH_BY_CONTAINS = `${DOMAIN_FRAGMENT}
query SearchByContains($needle: String!, $first: Int!, $skip: Int!) {
  domains(
    where: { name_contains: $needle }
    orderBy: name
    orderDirection: asc
    first: $first
    skip: $skip
  ) { ...DomainFields }
}`

export const searchByContains = (needle: string, first: number, skip: number) =>
  cached('searchByContains', { needle, first, skip }, async () => {
    const data = await gql<{ domains: ENSNodeDomain[] }>(SEARCH_BY_CONTAINS, { needle, first, skip })
    return data.domains
  })

const GET_DOMAINS_BY_OWNER = `${DOMAIN_FRAGMENT}
query GetDomainsByOwner($owner: String!, $first: Int!, $skip: Int!) {
  domains(
    where: { owner: $owner }
    orderBy: name
    orderDirection: asc
    first: $first
    skip: $skip
  ) { ...DomainFields }
}`

export const getDomainsByOwner = (owner: string, first: number, skip: number) =>
  cached('getDomainsByOwner', { owner, first, skip }, async () => {
    const data = await gql<{ domains: ENSNodeDomain[] }>(GET_DOMAINS_BY_OWNER, {
      owner: owner.toLowerCase(),
      first,
      skip,
    })
    return data.domains
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
    return data.domains[0] ?? null
  })
