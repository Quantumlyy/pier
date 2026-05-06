import { Elysia } from 'elysia'

import { TDomainsResponse, TFloorPriceQuery, TTotalStats } from '../lib/schemas.ts'
import { defaultTotalStats } from '../lib/shape.ts'

export const statsRoutes = new Elysia({ tags: ['stats'] })
  .get('/total_stats', () => defaultTotalStats(), {
    response: TTotalStats,
    detail: { summary: 'Marketplace stats (stubbed: zeros — Reservoir is gone)' },
  })
  .get('/floor_price', () => ({ domains: [] }), {
    query: TFloorPriceQuery,
    response: TDomainsResponse,
    detail: { summary: 'Floor price by category (stubbed: empty)' },
  })
