import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
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
    .use(
      openapi({
        path: '/docs',
        documentation: {
          info: {
            title: 'pier',
            version: '0.1.0',
            description:
              'A Bun + Elysia drop-in for the dead jetty backend. ENS data comes from ENSNode; Reservoir-shaped routes return empty/zero responses.',
          },
          tags: [
            { name: 'health', description: 'Liveness probes' },
            { name: 'auth', description: 'SIWE nonce / verify / session check' },
            { name: 'search', description: 'Domain search backed by ENSNode' },
            { name: 'domain', description: 'Per-domain metadata' },
            { name: 'user', description: 'Owned domains, likes, cart' },
            { name: 'stats', description: 'Marketplace stats (stubbed)' },
            { name: 'feed', description: 'Activity feeds (stubbed)' },
          ],
        },
      }),
    )
    .onError(({ error, code, set }) => {
      if (code === 'NOT_FOUND') return { error: 'not found' }
      if (code === 'VALIDATION') {
        // 4xx client error: the schema rejected the request. Don't log
        // (these aren't pier bugs) and don't echo the offending body —
        // Elysia's default message includes it. Surface just the field
        // path + reason so the client can fix the call.
        set.status = 422
        const e = error as {
          type?: string
          valueError?: { path?: string; message?: string }
        }
        const where = e.type ? `${e.type}${e.valueError?.path ?? ''}` : 'request'
        const why = e.valueError?.message ?? 'validation failed'
        return { error: `invalid ${where}: ${why}` }
      }
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
  const port = app.server?.port ?? env.PORT
  console.log(`pier listening on http://localhost:${port}`)
  console.log(`docs:  http://localhost:${port}/docs`)
  console.log(`spec:  http://localhost:${port}/docs/json`)
}
