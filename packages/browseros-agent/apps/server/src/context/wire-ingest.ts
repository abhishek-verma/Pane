/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Builds the post-gate `onToolSettled` callback used by the loop and MCP.
 */

import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import type { GateHooks } from '../agent/trust/gate'
import type { Workspace } from '../tools/filesystem/workspace'
import {
  type IngestBrowserContext,
  ingestToolResult,
  summarizeToolResult,
} from './ingest'

export interface IngestWireOptions {
  getBucketId: () => string
  getRunId?: () => string | undefined
  getBrowserContext?: () => IngestBrowserContext | undefined
  getWorkspace?: () =>
    | { root: string; workspaceId?: string }
    | Workspace
    | undefined
}

export function buildIngestGateHooks(options: IngestWireOptions): GateHooks {
  return {
    onToolSettled: ({ toolName, args, result, ctx }) => {
      const browserContext: IngestBrowserContext | undefined =
        options.getBrowserContext?.() ??
        (ctx.browserContext
          ? {
              activeTab: ctx.browserContext.activeTab
                ? {
                    url: ctx.browserContext.activeTab.url,
                    title: ctx.browserContext.activeTab.title,
                    pageId: ctx.browserContext.activeTab.pageId,
                  }
                : undefined,
            }
          : undefined)

      const workspace = options.getWorkspace?.()
      ingestToolResult({
        bucketId: options.getBucketId() || DEFAULT_BUCKET_ID,
        runId: options.getRunId?.() ?? ctx.runId ?? ctx.conversationId,
        toolName,
        args,
        resultSummary: summarizeToolResult(result),
        browserContext,
        workspace: workspace
          ? {
              root: workspace.root,
              workspaceId:
                'workspaceId' in workspace ? workspace.workspaceId : undefined,
            }
          : ctx.workspaceRoot
            ? { root: ctx.workspaceRoot }
            : undefined,
      })
    },
  }
}
