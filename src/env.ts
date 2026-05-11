import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8000),
  ENSNODE_URL: z.string().url().default('https://api.alpha.ensnode.io/subgraph'),
  GRAILS_ANALYTICS_BASE: z
    .preprocess(
      (v) => (v === undefined || v === null || String(v).trim() === '' ? undefined : v),
      z.string().url().optional(),
    ),
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3071')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  SESSION_TTL_MS: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

export const env = schema.parse(process.env)
export type Env = typeof env

export const allowedDomains = new Set(
  env.ALLOWED_ORIGINS.map((origin) => {
    try {
      return new URL(origin).host
    } catch {
      return origin
    }
  }),
)
