import type { createApiRoutes } from './api/routes'

/**
 * Flattened for hono/client. Inferring via
 * `Awaited<ReturnType<typeof createHttpServer>>['app']` hits TS2589
 * (excessively deep instantiation) once the route graph is large.
 */
type ApiApp = ReturnType<typeof createApiRoutes>
export interface AppType extends ApiApp {}
