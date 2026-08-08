/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { BrowserSession } from '@browseros/browser-core/core/session'
import { createBrowserMcpServer } from '@browseros/browser-mcp/mcp-server'
import { createDefaultMcpGateContext } from '@browseros/browser-mcp/trust/mcp-gate'
import type {
  ConsequenceClass,
  GateApprovalResolution,
  TrustPin,
} from '@browseros/shared/trust/consequence-class'
import { ingestToolResult, summarizeToolResult } from '../../../context/ingest'
import { registerContextMcpTools } from '../../../context/register-mcp'
import { logger } from '../../../lib/logger'
import { metrics } from '../../../lib/metrics'
import {
  MCP_APPROVAL_TIMEOUT_MS,
  requestChannelApproval,
} from '../../../scheduler/approvals'
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
  /** X-BrowserOS-Scope-Id header value; groups approvals for this MCP client. */
  scopeId?: string
  /** Trust pins for the associated conversation (if any). */
  trustPins?: Partial<Record<ConsequenceClass, TrustPin>>
}

/** Creates a per-request BrowserOS MCP server with tools for the requested surface. */
export function createMcpServer(deps: McpServiceDeps) {
  const bucketId = deps.bucketId ?? 'default'
  const runId = deps.scopeId ?? 'ephemeral'
  const gateContext = createDefaultMcpGateContext({
    workspaceRoot: deps.executionDir,
    runId,
    pins: deps.trustPins ?? {},
    // For an ACP provider (e.g. Claude Code) pointed at our own /mcp,
    // buildBrowserOsSelfMcpEntry forwards the real chat conversationId as
    // X-BrowserOS-Scope-Id — the same id apps/app polls in
    // useConversationPendingApprovals. Passing it through here is what lets
    // a pending approval show up as a normal in-chat Approve/Deny card
    // instead of only reaching the user via the (much slower, opt-in) reach
    // channel. For a genuinely external MCP client with no open Pane
    // conversation this just won't match anything — harmless.
    conversationId: deps.scopeId,
    requestApproval: async (request): Promise<GateApprovalResolution> => {
      const { resolution } = await requestChannelApproval({
        runId,
        conversationId: deps.scopeId,
        toolCallId: crypto.randomUUID(),
        toolName: request.toolName,
        consequenceClass: request.consequenceClass,
        preview: request.preview,
        timeoutMs: MCP_APPROVAL_TIMEOUT_MS,
      })
      return resolution
    },
  })

  const server = createBrowserMcpServer({
    name: 'pane_mcp',
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
