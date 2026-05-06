export type MarketplaceDomainType = {
  name: string
  name_ens: string
  expire_time: number | null
  owner: string | null
  terms: string[] | null
  taxonomies: string[] | null
  last_price: string | null
  last_sale_asset: string | null
  likes: number
  listing_time: number | string | null
  listing_price: string | null
  highest_offer: string | null
  registration_price: number | null
  premium_reg_price: string | null
  has_offers: boolean
  views: number
}

export type ExpiresEntry = {
  domain: string
  expires: number
}

export type CategoriesEntry = {
  domain: string
  categories: string[]
}

export type TotalStatsType = {
  average_sale: string
  daily_sales: string
  highest_reg: string
  highest_reg_domain_name: string
  highest_sale: string
  last_reg: string
  last_reg_domain_name: string
  last_sale: string
  last_sale_domain_name: string
  reg_volume_day: string
  trending_category: string
  trending_category_volume: string
  volume_day: string
  volume_month: string
  volume_week: string
}

export type ENSNodeDomain = {
  id: string
  name: string | null
  labelName: string | null
  owner: { id: string } | null
  registrant: { id: string } | null
  expiryDate: string | null
  createdAt: string | null
  registration: {
    registrationDate: string | null
    expiryDate: string | null
  } | null
}
