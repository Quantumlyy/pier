import { Elysia } from 'elysia'

export const feedRoutes = new Elysia()
  .get('/feed/activity/domain', () => ({ events: [] }))
  .get('/feed/events', () => ({ events: [] }))
  .get('/feed/aggregate', () => ({ aggregations: [] }))
