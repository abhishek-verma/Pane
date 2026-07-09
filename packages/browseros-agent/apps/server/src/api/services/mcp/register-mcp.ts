import type { BrowserSession } from '@browseros/browser-core/core/session'
import type { BrowserOutputFileAccess } from '@browseros/browser-mcp/output-file'
import {
  type BrowserToolDefaults,
  registerBrowserTools,
} from '@browseros/browser-mcp/register'
import { createDefaultMcpGateContext } from '@browseros/browser-mcp/trust/mcp-gate'
import type { GateContext } from '@browseros/shared/trust/consequence-class'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ingestToolResult, summarizeToolResult } from '../../../context/ingest'
import { logger } from '../../../lib/logger'
import { metrics } from '../../../lib/metrics'
import { registerFilesystemMcpTools } from '../../../tools/filesystem/register-mcp'
import { shouldLogToolRegistration } from '../../../tools/registration-log-sampling'

export interface RemoteAgentHarnessTools {
  outputFileAccess: BrowserOutputFileAccess
}

export interface RegisterToolsDeps extends BrowserToolDefaults {
  browserSession: BrowserSession
  executionDir: string
  remoteAgentHarness?: RemoteAgentHarnessTools
  gateContext?: GateContext
  bucketId?: string
}

/** Registers BrowserOS MCP tools for the current request. */
export function registerTools(
  mcpServer: McpServer,
  deps: RegisterToolsDeps,
): void {
  const defaults = {
    defaultWindowId: deps.defaultWindowId,
    defaultTabGroupId: deps.defaultTabGroupId,
  }
  const bucketId = deps.bucketId ?? 'default'
  const gateContext = deps.gateContext ?? createDefaultMcpGateContext()

  registerBrowserTools(mcpServer, deps.browserSession, defaults, {
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
  })

  if (deps.remoteAgentHarness) {
    registerFilesystemMcpTools(mcpServer, deps.executionDir, {
      outputFileAccess: deps.remoteAgentHarness.outputFileAccess,
      gateContext,
    })
  }
}
