/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createDefaultMcpGateContext } from '@browseros/browser-mcp/trust/mcp-gate'
import type { GateContext } from '@browseros/shared/trust/consequence-class'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'
import { buildPaneToolSet, type PaneToolContext } from '../agent/pane-toolset'
import { gateExecute } from '../agent/trust/gate'

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
  options: PaneToolContext & { gateContext?: GateContext } = {},
): void {
  const register = server.registerTool.bind(server) as unknown as McpRegisterFn
  const tools = buildPaneToolSet(options) as unknown as Record<
    string,
    AiSdkToolLike
  >

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
  // Nudge/UI tools already return MCP text content. Do not nest that envelope
  // inside JSON: both the model and chat cards consume the same payload.
  const textContent = Array.isArray(result.content)
    ? result.content.filter(
        (item): item is { type: 'text'; text: string } =>
          item !== null &&
          typeof item === 'object' &&
          item.type === 'text' &&
          typeof item.text === 'string',
      )
    : []
  return {
    content: [
      {
        type: 'text' as const,
        text:
          typeof result.text === 'string'
            ? result.text
            : textContent.length
              ? textContent.map((item) => item.text).join('\n')
              : JSON.stringify(result),
      },
    ],
    isError: result.isError === true,
  }
}
