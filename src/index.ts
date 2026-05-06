import { Hono } from 'hono'
import { logger } from 'hono/logger'

import { env } from './env.ts'
import { cors } from './lib/cors.ts'
import { healthRoutes } from './routes/health.ts'

const app = new Hono()

app.use('*', cors)
app.use('*', logger())

app.onError((err, c) => {
  console.error('[pier] unhandled error:', err)
  return c.json({ error: err.message }, 500)
})

app.notFound((c) => c.json({ error: 'not found', path: c.req.path }, 404))

app.route('/', healthRoutes)

const server = Bun.serve({ port: env.PORT, fetch: app.fetch })
console.log(`pier listening on http://localhost:${server.port}`)
