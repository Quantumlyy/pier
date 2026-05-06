import { Elysia } from 'elysia'

export const healthRoutes = new Elysia().get('/health_check', () => ({ stable: true }))
