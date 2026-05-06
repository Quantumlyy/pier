import { t } from 'elysia'

export const TMarketplaceDomain = t.Object(
  {
    name: t.String(),
    name_ens: t.String(),
    expire_time: t.Union([t.Number(), t.Null()]),
    owner: t.Union([t.String(), t.Null()]),
    terms: t.Union([t.Array(t.String()), t.Null()]),
    taxonomies: t.Union([t.Array(t.String()), t.Null()]),
    last_price: t.Union([t.String(), t.Null()]),
    last_sale_asset: t.Union([t.String(), t.Null()]),
    likes: t.Number(),
    listing_time: t.Union([t.Number(), t.String(), t.Null()]),
    listing_price: t.Union([t.String(), t.Null()]),
    highest_offer: t.Union([t.String(), t.Null()]),
    registration_price: t.Union([t.Number(), t.Null()]),
    premium_reg_price: t.Union([t.String(), t.Null()]),
    has_offers: t.Boolean(),
    views: t.Number(),
  },
  { $id: 'MarketplaceDomain' },
)

export const TDomainsResponse = t.Object(
  { domains: t.Array(TMarketplaceDomain) },
  { $id: 'DomainsResponse' },
)

export const TExpiresEntry = t.Object(
  { domain: t.String(), expires: t.Number() },
  { $id: 'ExpiresEntry' },
)

export const TExpiresResponse = t.Object(
  { domains: t.Array(TExpiresEntry) },
  { $id: 'ExpiresResponse' },
)

export const TCategoriesEntry = t.Object(
  { domain: t.String(), categories: t.Array(t.String()) },
  { $id: 'CategoriesEntry' },
)

export const TCategoriesResponse = t.Object(
  { domains: t.Array(TCategoriesEntry) },
  { $id: 'CategoriesResponse' },
)

export const TTotalStats = t.Object(
  {
    average_sale: t.String(),
    daily_sales: t.String(),
    highest_reg: t.String(),
    highest_reg_domain_name: t.String(),
    highest_sale: t.String(),
    last_reg: t.String(),
    last_reg_domain_name: t.String(),
    last_sale: t.String(),
    last_sale_domain_name: t.String(),
    reg_volume_day: t.String(),
    trending_category: t.String(),
    trending_category_volume: t.String(),
    volume_day: t.String(),
    volume_month: t.String(),
    volume_week: t.String(),
  },
  { $id: 'TotalStats' },
)

export const TFeedEventsResponse = t.Object(
  { events: t.Array(t.Unknown()) },
  { $id: 'FeedEventsResponse', description: 'Stubbed: always empty (Reservoir is gone)' },
)

export const TFeedAggregateResponse = t.Object(
  { aggregations: t.Array(t.Unknown()) },
  { $id: 'FeedAggregateResponse', description: 'Stubbed: always empty (Reservoir is gone)' },
)

export const TError = t.Object({ error: t.String() }, { $id: 'Error' })

// ── Query / body schemas ────────────────────────────────────────────────────

export const TPaginationQuery = t.Object({
  limit: t.Optional(t.String({ description: 'page size (default 20, max 100)' })),
  offset: t.Optional(t.String({ description: 'rows to skip (default 0)' })),
})

export const TSearchQuery = t.Object({
  name: t.Optional(t.String({ description: 'search term; .eth suffix is stripped' })),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
  search_type: t.Optional(t.String()),
  order_type: t.Optional(t.String()),
  status_type: t.Optional(t.String()),
  date_status: t.Optional(t.String()),
  has_offers_selector: t.Optional(t.String()),
  name_result: t.Optional(t.String()),
  name_symbols_type: t.Optional(t.String()),
  search_taxa: t.Optional(t.String()),
  search_terms: t.Optional(t.String()),
  min_domain_length: t.Optional(t.String()),
  max_domain_length: t.Optional(t.String()),
  min_listing_price: t.Optional(t.String()),
  max_listing_price: t.Optional(t.String()),
})

export const TRollQuery = t.Object({
  limit: t.Optional(t.String()),
  status: t.Optional(t.String()),
})

export const TDomainsListQuery = t.Object({
  domains: t.Optional(t.String({ description: 'comma-separated domain names or token IDs' })),
})

export const TOwnerQuery = t.Object({
  owner: t.Optional(t.String({ description: '0x-prefixed Ethereum address' })),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
})

export const TFloorPriceQuery = t.Object({
  category: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
})

export const TFeedEventsQuery = t.Object({
  domain_name: t.Optional(t.String()),
  event_types: t.Optional(t.String()),
  search_taxa: t.Optional(t.String()),
  search_terms: t.Optional(t.String()),
  min_timestamp: t.Optional(t.String()),
  max_timestamp: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
})

export const TFeedAggregateQuery = t.Object({
  event_type: t.Optional(t.String()),
  time_unit: t.Optional(t.String()),
  time_range: t.Optional(t.String()),
  domain_name: t.Optional(t.String()),
  search_taxa: t.Optional(t.String()),
  search_terms: t.Optional(t.String()),
  min_timestamp: t.Optional(t.String()),
})

export const TFeedActivityQuery = t.Object({
  domain_name: t.Optional(t.String()),
  limit: t.Optional(t.String()),
})

export const TVerifyBody = t.Object({
  message: t.String({ description: 'EIP-4361 SIWE message (full string)' }),
  signature: t.String({ description: '0x-prefixed signature hex' }),
})

export const TVerifyOk = t.Object({ ok: t.Literal(true) })

export const TAuthOk = t.Object({ address: t.String({ description: 'lowercased 0x address' }) })

export const TLikeBody = t.Object({ domain_id: t.String() })

export const TCartItemBody = t.Object({
  basket: t.Union([
    t.Literal('PURCHASE'),
    t.Literal('LIST'),
    t.Literal('OFFER'),
    t.Literal('REGISTER'),
    t.Literal('SNIPE'),
    t.Literal('EXTEND'),
  ]),
  id: t.String({ description: 'domain name (the frontend sends domain.name here)' }),
})
