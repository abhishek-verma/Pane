/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { SessionStore } from '../../agent/session-store'
import type { TurnRegistry } from '../../lib/agents/turns/active-turn-registry'
import type { OAuthTokenManager } from '../../lib/clients/oauth/token-manager'
import { requireTrustedOrigin } from '../middleware/require-trusted-origin'
import type { Env, HttpServerConfig } from '../types'
import { defaultCorsConfig } from '../utils/cors'
import { requireTrustedAppOrigin } from '../utils/request-auth'
import { createAcpxProbeRoutes } from './acpx-probe'
import { createActionLogRoutes } from './action-log'
import { createAgentRoutes } from './agents'
import { createCaptureRoutes } from './capture'
import { createChatRoutes } from './chat'
import { createContextRoutes } from './context'
import { createHealthRoute } from './health'
import { createMcpRoutes } from './mcp'
import { createMcpManagerRoutes } from './mcp-manager'
import { createMemoryRoutes } from './memory'
import { createNudgeMcpRoute } from './nudge-mcp'
import { createOAuthRoutes } from './oauth'
import { createProviderRoutes } from './provider'
import { createReachRoutes } from './reach'
import { createRefinePromptRoutes } from './refine-prompt'
import { createSchedulerRoutes } from './scheduler'
import { createScreencastRoute } from './screencast'
import { createShutdownRoute } from './shutdown'
import { createStatusRoute } from './status'
import { createTasksRoutes } from './tasks'
import { createTrustRoutes } from './trust'
import { createWorkspaceRoutes } from './workspace'

interface CreateApiRoutesDeps {
  agentRoutes?: Hono<Env>
  config: HttpServerConfig
  onShutdown: () => void
  tokenManager: OAuthTokenManager | null
  turnRegistry: TurnRegistry
}

/** Composes the BrowserOS HTTP API from the existing route factories. */
export function createApiRoutes(deps: CreateApiRoutesDeps) {
  const { agentRoutes, config, tokenManager, turnRegistry } = deps
  const {
    browser,
    browserosId,
    browserSession,
    executionDir,
    port,
    resourcesDir,
    version,
  } = config

  // Shared so /chat and /trust/replay update the same live + SQLite transcript.
  const sessionStore = new SessionStore()

  return (
    new Hono<Env>()
      .use('/*', cors(defaultCorsConfig))
      .use('/*', requireTrustedOrigin())
      .route('/health', createHealthRoute({ browser }))
      .route('/shutdown', createShutdownRoute({ onShutdown: deps.onShutdown }))
      .route('/status', createStatusRoute({ browser }))
      .route('/action-log', createActionLogRoutes())
      .route('/context', createContextRoutes())
      .route('/capture', createCaptureRoutes())
      .route('/tasks', createTasksRoutes())
      .route('/memory', createMemoryRoutes())
      .route('/scheduler', createSchedulerRoutes())
      .route('/reach', createReachRoutes())
      .route('/workspace', createWorkspaceRoutes())
      .route(
        '/trust',
        createTrustRoutes({
          browser,
          browserSession,
          browserosId,
          sessionStore,
        }),
      )
      .route(
        '/test-provider',
        createProviderRoutes({ browserosId, resourcesDir }),
      )
      .route('/acpx/probe', createAcpxProbeRoutes({ resourcesDir }))
      .route('/refine-prompt', createRefinePromptRoutes({ browserosId }))
      .route('/oauth', oauthRoutes(tokenManager))
      .route(
        '/mcp',
        createMcpRoutes({
          version,
          browserSession,
          executionDir,
        }),
      )
      // Dedicated in-process MCP server for the suggest_app_connection
      // tool. Reachable only by the ACPX-spawned host agent process; not
      // published to external agents installed via the Integrations
      // panel (those receive the /mcp URL only).
      .route('/mcp/nudge', createNudgeMcpRoute({ turnRegistry }))
      .route(
        '/mcp-manager',
        createMcpManagerRoutes({
          getMcpUrl: () => `http://127.0.0.1:${port}/mcp`,
        }),
      )
      .route(
        '/chat',
        createChatRoutes({
          browser,
          browserSession,
          browserosId,
          serverPort: port,
          resourcesDir,
          sessionStore,
        }),
      )
      .route('/screencast', createScreencastRoute({ browser }))
      .route('/agents', protectedAgentRoutes(config, turnRegistry, agentRoutes))
  )
}

function protectedAgentRoutes(
  config: HttpServerConfig,
  turnRegistry: TurnRegistry,
  routes?: Hono<Env>,
) {
  return new Hono<Env>().use('/*', requireTrustedAppOrigin()).route(
    '/',
    routes ??
      createAgentRoutes({
        browserosServerPort: config.port,
        resourcesDir: config.resourcesDir,
        browser: config.browser,
        turnRegistry,
      }),
  )
}

function oauthRoutes(tokenManager: OAuthTokenManager | null) {
  const app = new Hono<Env>()
  if (tokenManager) return app.route('/', createOAuthRoutes({ tokenManager }))

  return app.all('/*', (c) => c.json({ error: 'OAuth not available' }, 503))
}
