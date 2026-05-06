import type {
  CategoriesEntry,
  ENSNodeDomain,
  ExpiresEntry,
  MarketplaceDomainType,
  TotalStatsType,
} from './types.ts'

const labelFromName = (name: string | null): string => {
  if (!name) return ''
  if (name.endsWith('.eth')) return name.slice(0, -'.eth'.length).split('.').pop() ?? ''
  return name.split('.').pop() ?? ''
}

const parseUnixSeconds = (raw: string | null | undefined): number | null => {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

// Prefer Registration.expiryDate (the actual BaseRegistrar expiry). For .eth
// 2LDs Domain.expiryDate is shifted forward 90 days because it includes the
// grace period — using it would make the UI show expiry dates that are 90
// days late and mislabel grace-period names as still active.
const pickExpiry = (d: ENSNodeDomain): number | null =>
  parseUnixSeconds(d.registration?.expiryDate ?? null) ?? parseUnixSeconds(d.expiryDate)

// Pick the address with BaseRegistrar ownership semantics:
//  - wrapped names: `wrappedOwner` (the user; `owner` is the NameWrapper).
//  - unwrapped names: `registrant` (the NFT holder; `owner` is the registry
//    manager and may be a delegated address).
//  - everything else: `owner` as a last resort.
// Frontend ownership checks compare against this field, so prefer the most
// authoritative source.
export const effectiveOwner = (d: ENSNodeDomain): string | null => {
  const wrapped = d.wrappedOwner?.id
  if (wrapped) return wrapped.toLowerCase()
  const registrant = d.registrant?.id
  if (registrant) return registrant.toLowerCase()
  const owner = d.owner?.id
  return owner ? owner.toLowerCase() : null
}

export const toMarketplaceDomain = (d: ENSNodeDomain): MarketplaceDomainType => ({
  // Frontend convention (NOT what the field names suggest):
  // - `name` is the full ENS string (e.g. "vitalik.eth"); used for display.
  // - `name_ens` is the label (e.g. "vitalik"); fed to getDomainHexId(label)
  //   = keccak256(label) to compute the BaseRegistrar tokenId for like /
  //   cart / offer / extend operations. Inverting these silently produces
  //   wrong token IDs and broken mutations.
  name: d.name ?? '',
  name_ens: d.labelName && d.labelName.length > 0 ? d.labelName : labelFromName(d.name),
  expire_time: pickExpiry(d),
  owner: effectiveOwner(d),
  terms: [],
  taxonomies: [],
  last_price: null,
  last_sale_asset: null,
  likes: 0,
  listing_time: null,
  listing_price: null,
  highest_offer: null,
  registration_price: null,
  premium_reg_price: null,
  has_offers: false,
  views: 0,
})

export const toExpiresEntry = (domain: string, d: ENSNodeDomain | undefined): ExpiresEntry => ({
  domain,
  expires: d ? pickExpiry(d) ?? 0 : 0,
})

export const toCategoriesEntry = (domain: string): CategoriesEntry => ({
  domain,
  categories: [],
})

export const defaultTotalStats = (): TotalStatsType => ({
  average_sale: '0',
  daily_sales: '0',
  highest_reg: '0',
  highest_reg_domain_name: '',
  highest_sale: '0',
  last_reg: '0',
  last_reg_domain_name: '',
  last_sale: '0',
  last_sale_domain_name: '',
  reg_volume_day: '0',
  trending_category: '',
  trending_category_volume: '0',
  volume_day: '0',
  volume_month: '0',
  volume_week: '0',
})
