import { Hono } from 'hono'
import { logger } from 'hono/logger'

import { env } from './env.ts'
import { cors } from './lib/cors.ts'
import { authRoutes } from './routes/auth.ts'
import { domainRoutes } from './routes/domain.ts'
import { feedRoutes } from './routes/feed.ts'
import { healthRoutes } from './routes/health.ts'
import { searchRoutes } from './routes/search.ts'
import { statsRoutes } from './routes/stats.ts'
import { userRoutes } from './routes/user.ts'

const app = new Hono()

app.use('*', cors)
app.use('*', logger())

app.onError((err, c) => {
  console.error('[pier] unhandled error:', err)
  return c.json({ error: err.message }, 500)
})

app.notFound((c) => c.json({ error: 'not found', path: c.req.path }, 404))

app.route('/', healthRoutes)
app.route('/', authRoutes)
app.route('/', searchRoutes)
app.route('/', domainRoutes)
app.route('/', userRoutes)
app.route('/', statsRoutes)
app.route('/', feedRoutes)

const server = Bun.serve({ port: env.PORT, fetch: app.fetch })
console.log(`pier listening on http://localhost:${server.port}`)
