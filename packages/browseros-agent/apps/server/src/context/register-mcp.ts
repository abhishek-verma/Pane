/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createDefaultMcpGateContext } from '@browseros/browser-mcp/trust/mcp-gate'
import type { GateContext } from '@browseros/shared/trust/consequence-class'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'
import { buildAgendaToolSet } from '../agenda/tools'
import { buildSchedulerToolSet } from '../agent/scheduler-tools'
import { gateExecute } from '../agent/trust/gate'
import { buildCaptureToolSet } from '../capture/tools'
import { buildMemoryToolSet } from '../memory/tools'
import { buildPersonalInternetToolSet } from '../personal-internet/tools'
import { buildContextToolSet, buildTasksToolSet } from './tools'

interface AiSdkToolLike {
  description?: string
  inputSchema: z.ZodObject<z.ZodRawShape>
  execute: (
    args: Record<string, unknown>,
    options: { signal?: AbortSignal },
  ) => Promise<Record<string, unknown>>
}

type McpRegisterFn = (
  name: string,
  config: { description: string; inputSchema: z.ZodRawShape },
  handler: (
    args: Record<string, unknown>,
    extra?: { signal?: AbortSignal },
  ) => Promise<{
    content: Array<{ type: 'text'; text: string }>
    isError?: boolean
  }>,
) => void

export function registerContextMcpTools(
  server: McpServer,
  options: { bucketId?: string; gateContext?: GateContext } = {},
): void {
  const register = server.registerTool.bind(server) as unknown as McpRegisterFn
  const getBucketId = () => options.bucketId ?? 'default'
  const tools = {
    ...buildContextToolSet(getBucketId),
    ...buildTasksToolSet(getBucketId),
    ...buildMemoryToolSet(getBucketId),
    ...buildCaptureToolSet(getBucketId),
    ...buildPersonalInternetToolSet(getBucketId),
    // ACP providers receive Pane tools through this MCP server rather than
    // the in-process AI SDK ToolLoopAgent. Keep scheduler controls here so
    // Claude Code, Codex, and API-key providers expose the same automation
    // management surface.
    ...buildSchedulerToolSet(),
    ...buildAgendaToolSet(),
  } as unknown as Record<string, AiSdkToolLike>

  for (const [name, tool] of Object.entries(tools)) {
    register(
      name,
      {
        description: tool.description ?? '',
        inputSchema: tool.inputSchema.shape,
      },
      async (args, extra) => {
        const result = await gateExecute(
          name,
          args,
          {
            ...(options.gateContext ?? createDefaultMcpGateContext()),
            surface: 'mcp',
          },
          async (cleanArgs) => {
            const output = toMcpToolResult(
              await tool.execute(cleanArgs, { signal: extra?.signal }),
            )
            return { text: output.content[0].text, isError: output.isError }
          },
          'text',
        )
        return toMcpToolResult(result)
      },
    )
  }
}

/** AI SDK tools may return structured data, not only a { text } envelope. */
export function toMcpToolResult(result: Record<string, unknown>) {
  return {
    content: [
      {
        type: 'text' as const,
        text:
          typeof result.text === 'string'
            ? result.text
            : JSON.stringify(result),
      },
    ],
    isError: result.isError === true,
  }
}
