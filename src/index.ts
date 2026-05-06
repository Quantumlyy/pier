import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'

import { env } from './env.ts'
import { authRoutes } from './routes/auth.ts'
import { domainRoutes } from './routes/domain.ts'
import { feedRoutes } from './routes/feed.ts'
import { healthRoutes } from './routes/health.ts'
import { searchRoutes } from './routes/search.ts'
import { statsRoutes } from './routes/stats.ts'
import { userRoutes } from './routes/user.ts'

export const buildApp = () =>
  new Elysia()
    .use(
      cors({
        origin: env.ALLOWED_ORIGINS,
        credentials: true,
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['content-type', 'id', 'cookie', 'accept'],
        maxAge: 600,
      }),
    )
    .onError(({ error, code }) => {
      if (code === 'NOT_FOUND') return { error: 'not found' }
      console.error('[pier] unhandled error:', error)
      return { error: error instanceof Error ? error.message : 'internal error' }
    })
    .use(healthRoutes)
    .use(authRoutes)
    .use(searchRoutes)
    .use(domainRoutes)
    .use(userRoutes)
    .use(statsRoutes)
    .use(feedRoutes)

if (import.meta.main) {
  const app = buildApp().listen(env.PORT)
  console.log(`pier listening on http://localhost:${app.server?.port ?? env.PORT}`)
}
