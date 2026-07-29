/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createDefaultMcpGateContext } from '@browseros/browser-mcp/trust/mcp-gate'
import type { GateContext } from '@browseros/shared/trust/consequence-class'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'
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
  ) => Promise<{ text: string; isError?: boolean }>
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
          async (cleanArgs) =>
            tool.execute(cleanArgs, { signal: extra?.signal }),
          'text',
        )
        return {
          content: [{ type: 'text', text: result.text || '' }],
          isError: result.isError,
        }
      },
    )
  }
}
