/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Browser } from '../../../browser/browser'
import type { BrowserSession } from '../../../browser/core/session'
import {
  type KlavisProxyRef,
  registerKlavisTools,
} from '../klavis/strata-proxy'
import { MCP_INSTRUCTIONS } from './mcp-prompt'
import { registerTools } from './register-mcp'

export interface McpServiceDeps {
  version: string
  browser: Browser
  browserSession: BrowserSession
  klavisRef?: KlavisProxyRef
  browserUseNewTools: boolean
  defaultWindowId?: number
  defaultTabGroupId?: string
}

export function createMcpServer(deps: McpServiceDeps): McpServer {
  const server = new McpServer(
    {
      name: 'browseros_mcp',
      title: 'BrowserOS MCP server',
      version: deps.version,
    },
    { capabilities: { logging: {} }, instructions: MCP_INSTRUCTIONS },
  )

  server.server.setRequestHandler(SetLevelRequestSchema, () => {
    return {}
  })

  registerTools(server, {
    browser: deps.browser,
    browserSession: deps.browserSession,
    useNewTools: deps.browserUseNewTools,
    defaultWindowId: deps.defaultWindowId,
    defaultTabGroupId: deps.defaultTabGroupId,
  })

  if (deps.klavisRef?.handle) {
    registerKlavisTools(server, deps.klavisRef.handle)
  }

  return server
}
