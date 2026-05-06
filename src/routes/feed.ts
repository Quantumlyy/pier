import { Hono } from 'hono'

export const feedRoutes = new Hono()
  .get('/feed/activity/domain', (c) => c.json({ events: [] }))
  .get('/feed/events', (c) => c.json({ events: [] }))
  .get('/feed/aggregate', (c) => c.json({ aggregations: [] }))
