/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { BrowserSession } from '@browseros/browser-core/core/session'
import { createBrowserMcpServer } from '@browseros/browser-mcp/mcp-server'
import { createDefaultMcpGateContext } from '@browseros/browser-mcp/trust/mcp-gate'
import { ingestToolResult, summarizeToolResult } from '../../../context/ingest'
import { registerContextMcpTools } from '../../../context/register-mcp'
import { logger } from '../../../lib/logger'
import { metrics } from '../../../lib/metrics'
import { registerFilesystemMcpTools } from '../../../tools/filesystem/register-mcp'
import { shouldLogToolRegistration } from '../../../tools/registration-log-sampling'
import { MCP_INSTRUCTIONS } from './mcp-prompt'
import type { RemoteAgentHarnessTools } from './register-mcp'

export interface McpServiceDeps {
  version: string
  browserSession: BrowserSession
  defaultWindowId?: number
  defaultTabGroupId?: string
  executionDir: string
  remoteAgentHarness?: RemoteAgentHarnessTools
  bucketId?: string
}

/** Creates a per-request BrowserOS MCP server with tools for the requested surface. */
export function createMcpServer(deps: McpServiceDeps) {
  const bucketId = deps.bucketId ?? 'default'
  const gateContext = createDefaultMcpGateContext({
    workspaceRoot: deps.executionDir,
  })

  const server = createBrowserMcpServer({
    name: 'browseros_mcp',
    title: 'Pane MCP server',
    version: deps.version,
    browserSession: deps.browserSession,
    defaultWindowId: deps.defaultWindowId,
    defaultTabGroupId: deps.defaultTabGroupId,
    instructions: MCP_INSTRUCTIONS,
    registration: {
      outputFileAccess: deps.remoteAgentHarness?.outputFileAccess,
      logger,
      onToolExecuted: (event) => metrics.log('tool_executed', event),
      onToolSettled: ({ toolName, args, result }) => {
        if (result.isError) return
        ingestToolResult({
          bucketId,
          toolName,
          args,
          resultSummary: summarizeToolResult(result),
          browserContext: gateContext.browserContext
            ? {
                activeTab: gateContext.browserContext.activeTab
                  ? {
                      url: gateContext.browserContext.activeTab.url,
                      title: gateContext.browserContext.activeTab.title,
                      pageId: gateContext.browserContext.activeTab.pageId,
                    }
                  : undefined,
                isPrivate: gateContext.browserContext.isPrivate,
              }
            : undefined,
          workspace: gateContext.workspaceRoot
            ? { root: gateContext.workspaceRoot }
            : undefined,
        })
      },
      shouldLogToolRegistration,
      source: 'mcp',
      gateContext,
    },
  })

  if (deps.remoteAgentHarness) {
    registerFilesystemMcpTools(server, deps.executionDir, {
      outputFileAccess: deps.remoteAgentHarness.outputFileAccess,
      gateContext,
    })
  }

  // Always expose context/tasks on /mcp so CLI + external MCP clients can use them.
  registerContextMcpTools(server, { bucketId, gateContext })

  return server
}
