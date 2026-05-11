import { Elysia } from 'elysia'

import { TDomainsResponse, TFloorPriceQuery, TTotalStats } from '../lib/schemas.ts'
import { defaultTotalStats } from '../lib/shape.ts'
import { fetchEthRegistrationStats } from '../upstreams/ensnode.ts'
import { fetchGrailsSalesStats } from '../upstreams/grails.ts'
import { tryCatch } from '../lib/utils/tryCatch.ts'

export const statsRoutes = new Elysia({ tags: ['stats'] })
  .get(
    '/total_stats',
    async () => {
      const grails = await tryCatch(fetchGrailsSalesStats())
      const ethRegistration = await tryCatch(fetchEthRegistrationStats())

      const stats = {
        ...defaultTotalStats(),
        ...grails.data ?? {},
        ...ethRegistration.data ?? {},
      }

      return stats
    },
    {
      response: TTotalStats,
      detail: {
        summary:
          'Monetary fields are integer wei strings (no decimal point) for Kodex `formatEtherPrice`. Registration: ENSNode .eth 2LDs. Sales: optional `GRAILS_ANALYTICS_BASE` → Grails market + sales APIs.',
      },
    },
  )
  .get('/floor_price', () => ({ domains: [] }), {
    query: TFloorPriceQuery,
    response: TDomainsResponse,
    detail: { summary: 'Floor price by category (stubbed: empty)' },
  })
