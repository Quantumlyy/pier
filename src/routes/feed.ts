import { Elysia } from 'elysia'

import {
  TFeedActivityQuery,
  TFeedAggregateQuery,
  TFeedAggregateResponse,
  TFeedEventsQuery,
  TFeedEventsResponse,
} from '../lib/schemas.ts'

export const feedRoutes = new Elysia({ tags: ['feed'] })
  .get('/feed/activity/domain', () => ({ events: [] }), {
    query: TFeedActivityQuery,
    response: TFeedEventsResponse,
    detail: { summary: 'Per-domain activity (stubbed: empty)' },
  })
  .get('/feed/events', () => ({ events: [] }), {
    query: TFeedEventsQuery,
    response: TFeedEventsResponse,
    detail: { summary: 'Marketplace activity feed (stubbed: empty)' },
  })
  .get('/feed/aggregate', () => ({ aggregations: [] }), {
    query: TFeedAggregateQuery,
    response: TFeedAggregateResponse,
    detail: { summary: 'Aggregated event volume (stubbed: empty)' },
  })
