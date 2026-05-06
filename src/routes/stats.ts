import { Elysia } from 'elysia'

import { defaultTotalStats } from '../lib/shape.ts'

export const statsRoutes = new Elysia()
  .get('/total_stats', () => defaultTotalStats())
  .get('/floor_price', () => ({ domains: [] }))
