import { Elysia, t } from 'elysia'

export const healthRoutes = new Elysia({ tags: ['health'] }).get(
  '/health_check',
  () => ({ stable: true }),
  {
    response: t.Object({ stable: t.Boolean() }),
    detail: { summary: 'Liveness probe' },
  },
)
