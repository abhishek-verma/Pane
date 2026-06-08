/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { StreamableHTTPTransport } from '@hono/mcp'
import { Hono } from 'hono'
import type { Browser } from '../../browser/browser'
import type { BrowserSession } from '../../browser/core/session'
import { logger } from '../../lib/logger'
import { metrics } from '../../lib/metrics'
import { Sentry } from '../../lib/sentry'
import type { KlavisProxyRef } from '../services/klavis/strata-proxy'
import { createMcpServer } from '../services/mcp/mcp-server'
import type { Env } from '../types'

interface McpRouteDeps {
  version: string
  browser: Browser
  browserSession: BrowserSession
  klavisRef?: KlavisProxyRef
  browserUseNewTools?: boolean
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  // CDP window ids are integers; `Number.isFinite('1.5')` would be true
  // and silently route to a non-integer that CDP rejects with an opaque
  // protocol error. Require an integer at the parse boundary.
  return Number.isInteger(n) ? n : undefined
}

export function createMcpRoutes(deps: McpRouteDeps) {
  const app = new Hono<Env>()

  app.get('/', (c) =>
    c.json({
      status: 'ok',
      message: 'MCP server is running. Use POST to interact.',
    }),
  )

  app.post('/', async (c) => {
    const scopeId = c.req.header('X-BrowserOS-Scope-Id') || 'ephemeral'
    metrics.log('mcp.request', { scopeId })

    // Lets the host pin every browser tool call in this request to a
    // specific window for page-creating tools.
    const defaultWindowId = parseOptionalNumber(
      c.req.header('X-BrowserOS-Default-Window-Id'),
    )

    // Same pattern for tab groups: the host pins every page-creating
    // call to a specific tab group so concurrent agents don't race for
    // the window's active group.
    const defaultTabGroupId =
      c.req.header('X-BrowserOS-Default-Tab-Group-Id') ?? undefined

    // Per-request server + transport: no shared state, no race conditions,
    // no ID collisions. Required by MCP SDK 1.26.0+ security fix (GHSA-345p-7cg4-v4c7).
    const mcpServer = createMcpServer({
      version: deps.version,
      browser: deps.browser,
      browserSession: deps.browserSession,
      klavisRef: deps.klavisRef,
      browserUseNewTools: deps.browserUseNewTools !== false,
      defaultWindowId,
      defaultTabGroupId,
    })
    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })

    try {
      await mcpServer.connect(transport)
      return transport.handleRequest(c)
    } catch (error) {
      Sentry.withScope((scope) => {
        scope.setTag('route', 'mcp')
        scope.setTag('scopeId', scopeId)
        Sentry.captureException(error)
      })
      logger.error('Error handling MCP request', {
        error: error instanceof Error ? error.message : String(error),
      })

      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        },
        500,
      )
    }
  })

  return app
}
