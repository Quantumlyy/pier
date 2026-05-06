import { Hono } from 'hono'

import { defaultTotalStats } from '../lib/shape.ts'

export const statsRoutes = new Hono()
  .get('/total_stats', (c) => c.json(defaultTotalStats()))
  .get('/floor_price', (c) => c.json({ domains: [] }))
