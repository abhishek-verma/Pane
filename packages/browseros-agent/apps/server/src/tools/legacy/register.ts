import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type ZodRawShape, z } from 'zod'
import type { Browser } from '../../browser/browser'
import { logger } from '../../lib/logger'
import { metrics } from '../../lib/metrics'
import { executeTool, type ToolDefinition } from './framework'
import { registry } from './registry'

type RegisterFn = (
  name: string,
  config: {
    description: string
    inputSchema?: ZodRawShape
  },
  handler: (
    args: Record<string, unknown>,
    extra?: { signal?: AbortSignal },
  ) => Promise<{
    content: unknown
    isError?: boolean
    structuredContent?: unknown
  }>,
) => void

interface LegacyToolDefaults {
  defaultWindowId?: number
  defaultTabGroupId?: string
}

function inputShape(tool: ToolDefinition): ZodRawShape | undefined {
  return tool.input instanceof z.ZodObject ? tool.input.shape : undefined
}

/**
 * Registers the legacy browser tool surface on an MCP server.
 */
export function registerLegacyBrowserTools(
  server: McpServer,
  browser: Browser,
  defaults: LegacyToolDefaults = {},
): void {
  const register = server.registerTool.bind(server) as unknown as RegisterFn
  const tools = registry.all()

  for (const tool of tools) {
    register(
      tool.name,
      {
        description: tool.description,
        inputSchema: inputShape(tool),
      },
      async (args, extra) => {
        const startTime = performance.now()
        try {
          const result = await executeTool(
            tool,
            args,
            {
              browser,
              directories: { workingDir: process.cwd() },
              ...defaults,
            },
            extra?.signal ?? new AbortController().signal,
          )
          metrics.log('tool_executed', {
            tool_name: tool.name,
            duration_ms: Math.round(performance.now() - startTime),
            success: !result.isError,
            source: 'mcp',
          })
          return {
            content: result.content,
            isError: result.isError,
            structuredContent: result.structuredContent,
          }
        } catch (error) {
          const errorText =
            error instanceof Error ? error.message : String(error)
          metrics.log('tool_executed', {
            tool_name: tool.name,
            duration_ms: Math.round(performance.now() - startTime),
            success: false,
            error_message: errorText,
            source: 'mcp',
          })
          return {
            content: [{ type: 'text' as const, text: errorText }],
            isError: true,
          }
        }
      },
    )
  }

  logger.info(
    `Registered ${tools.length} legacy browser tools: ${tools.map((t) => t.name).join(', ')}`,
  )
}
