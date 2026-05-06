import { Hono } from 'hono'

export const healthRoutes = new Hono().get('/health_check', (c) => c.json({ stable: true }))
