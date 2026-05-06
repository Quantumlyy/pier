import { describe, expect, test } from 'bun:test'

import {
  defaultTotalStats,
  toCategoriesEntry,
  toExpiresEntry,
  toMarketplaceDomain,
} from '../src/lib/shape.ts'
import type { ENSNodeDomain, MarketplaceDomainType } from '../src/lib/types.ts'

const baseDomain = (overrides: Partial<ENSNodeDomain> = {}): ENSNodeDomain => ({
  id: '0xabc',
  name: 'vitalik.eth',
  labelName: 'vitalik',
  owner: { id: '0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045' },
  registrant: { id: '0x220866b1a2219f40e72f5c628b65d54268ca3a9d' },
  expiryDate: '2468928330',
  createdAt: '1497775154',
  registration: { registrationDate: '1581013420', expiryDate: '2461152330' },
  ...overrides,
})

describe('toMarketplaceDomain', () => {
  test('maps a fully-populated ENSNode domain', () => {
    const result = toMarketplaceDomain(baseDomain())
    expect(result).toEqual({
      name: 'vitalik.eth',
      name_ens: 'vitalik',
      expire_time: 2461152330,
      owner: '0x220866b1a2219f40e72f5c628b65d54268ca3a9d',
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
  })

  test('lowercases the effective owner address', () => {
    const result = toMarketplaceDomain(
      baseDomain({ registrant: { id: '0x220866B1A2219F40E72F5C628B65D54268CA3A9D' } }),
    )
    expect(result.owner).toBe('0x220866b1a2219f40e72f5c628b65d54268ca3a9d')
  })

  test('owner falls to null when every source is missing', () => {
    expect(
      toMarketplaceDomain(baseDomain({ owner: null, registrant: null, wrappedOwner: null })).owner,
    ).toBeNull()
  })

  test('wrappedOwner wins over both registrant and registry owner', () => {
    const result = toMarketplaceDomain(
      baseDomain({
        owner: { id: '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401' }, // NameWrapper
        registrant: { id: '0x1111111111111111111111111111111111111111' },
        wrappedOwner: { id: '0x35396D0DBfFD9D4Eb1aFE1eA7c7DC76dA2F8e5E1' },
      }),
    )
    expect(result.owner).toBe('0x35396d0dbffd9d4eb1afe1ea7c7dc76da2f8e5e1')
  })

  test('registrant wins over registry owner for unwrapped delegated names', () => {
    const result = toMarketplaceDomain(
      baseDomain({
        owner: { id: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },        // delegated manager
        registrant: { id: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },   // NFT holder
        wrappedOwner: null,
      }),
    )
    expect(result.owner).toBe('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
  })

  test('owner is used only as a last resort', () => {
    const result = toMarketplaceDomain(
      baseDomain({
        owner: { id: '0xcccccccccccccccccccccccccccccccccccccccc' },
        registrant: null,
        wrappedOwner: null,
      }),
    )
    expect(result.owner).toBe('0xcccccccccccccccccccccccccccccccccccccccc')
  })

  test('derives the label from the full name when labelName is missing', () => {
    const result = toMarketplaceDomain(baseDomain({ labelName: null }))
    expect(result.name).toBe('vitalik.eth')
    expect(result.name_ens).toBe('vitalik')
  })

  test('derives the label as the last segment before .eth for multi-label names', () => {
    const result = toMarketplaceDomain(
      baseDomain({ labelName: null, name: 'sub.vitalik.eth' }),
    )
    expect(result.name).toBe('sub.vitalik.eth')
    expect(result.name_ens).toBe('vitalik')
  })

  test('empty labelName falls back to derivation', () => {
    const result = toMarketplaceDomain(baseDomain({ labelName: '' }))
    expect(result.name_ens).toBe('vitalik')
  })

  test('prefers registration.expiryDate (registrar) over Domain.expiryDate (grace-included)', () => {
    // Sample values borrow from a real ENSNode response for vitalik.eth:
    // Domain.expiryDate = registration.expiryDate + 90 days.
    const result = toMarketplaceDomain(baseDomain())
    expect(result.expire_time).toBe(2461152330)
  })

  test('falls back to Domain.expiryDate when registration is missing', () => {
    const result = toMarketplaceDomain(baseDomain({ registration: null }))
    expect(result.expire_time).toBe(2468928330)
  })

  test('returns null expiry when both sources are missing', () => {
    const result = toMarketplaceDomain(
      baseDomain({ expiryDate: null, registration: null }),
    )
    expect(result.expire_time).toBeNull()
  })

  test('coerces numeric-string registration expiry', () => {
    const result = toMarketplaceDomain(
      baseDomain({ registration: { registrationDate: '0', expiryDate: '1700000000' } }),
    )
    expect(result.expire_time).toBe(1700000000)
  })

  test('non-numeric expiry sources yield null', () => {
    const result = toMarketplaceDomain(
      baseDomain({
        expiryDate: 'not-a-number',
        registration: { registrationDate: '0', expiryDate: 'also-bad' },
      }),
    )
    expect(result.expire_time).toBeNull()
  })

  test('handles fully missing name', () => {
    const result = toMarketplaceDomain(baseDomain({ labelName: null, name: null }))
    expect(result.name).toBe('')
    expect(result.name_ens).toBe('')
  })

  test('JSON round-trip preserves all keys including nulls', () => {
    const result = toMarketplaceDomain(baseDomain({ owner: null, expiryDate: null, registration: null }))
    const roundtripped = JSON.parse(JSON.stringify(result)) as MarketplaceDomainType
    const expectedKeys: (keyof MarketplaceDomainType)[] = [
      'name', 'name_ens', 'expire_time', 'owner', 'terms', 'taxonomies',
      'last_price', 'last_sale_asset', 'likes', 'listing_time', 'listing_price',
      'highest_offer', 'registration_price', 'premium_reg_price', 'has_offers', 'views',
    ]
    for (const key of expectedKeys) {
      expect(roundtripped).toHaveProperty(key)
    }
  })

  test('default-fills marketplace fields when ENSNode has no marketplace data', () => {
    const result = toMarketplaceDomain(baseDomain())
    expect(result.terms).toEqual([])
    expect(result.taxonomies).toEqual([])
    expect(result.likes).toBe(0)
    expect(result.has_offers).toBe(false)
    expect(result.views).toBe(0)
    expect(result.last_price).toBeNull()
    expect(result.listing_price).toBeNull()
    expect(result.highest_offer).toBeNull()
  })
})

describe('toExpiresEntry', () => {
  test('uses the registrar expiry when present', () => {
    expect(toExpiresEntry('vitalik.eth', baseDomain())).toEqual({
      domain: 'vitalik.eth',
      expires: 2461152330,
    })
  })

  test('returns 0 expires for missing domain', () => {
    expect(toExpiresEntry('nope.eth', undefined)).toEqual({
      domain: 'nope.eth',
      expires: 0,
    })
  })

  test('returns 0 expires when domain has no expiry data', () => {
    expect(
      toExpiresEntry('foo.eth', baseDomain({ expiryDate: null, registration: null })),
    ).toEqual({ domain: 'foo.eth', expires: 0 })
  })
})

describe('toCategoriesEntry', () => {
  test('returns the domain with empty categories', () => {
    expect(toCategoriesEntry('vitalik.eth')).toEqual({
      domain: 'vitalik.eth',
      categories: [],
    })
  })
})

describe('defaultTotalStats', () => {
  test('returns full TotalStatsType shape with zero defaults', () => {
    const stats = defaultTotalStats()
    expect(stats).toEqual({
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
  })
})
