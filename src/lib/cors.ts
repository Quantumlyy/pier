import type { MiddlewareHandler } from 'hono'

import { env } from '../env.ts'

export const cors: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('origin')
  if (origin && env.ALLOWED_ORIGINS.includes(origin)) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Vary', 'Origin')
    c.header('Access-Control-Allow-Credentials', 'true')
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    c.header(
      'Access-Control-Allow-Headers',
      c.req.header('access-control-request-headers') ?? 'content-type, id, cookie, accept',
    )
    c.header('Access-Control-Max-Age', '600')
  }
  if (c.req.method === 'OPTIONS') return c.body(null, 204)
  await next()
}
