import type { BrowserSession } from '@browseros/browser-core/core/session'
import type { GateContext } from '@browseros/shared/trust/consequence-class'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ZodRawShape } from 'zod'
import { gateMcpHandler } from '../trust/mcp-gate'
import { executeTool } from './framework'
import {
  type BrowserOutputFileAccess,
  withBrowserOutputFileAccess,
} from './output-file'
import { BROWSER_TOOLS } from './registry'

type RegisterFn = (
  name: string,
  config: {
    description: string
    inputSchema?: ZodRawShape
    outputSchema?: ZodRawShape
    annotations?: Record<string, unknown>
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

export interface BrowserToolDefaults {
  defaultWindowId?: number
  defaultTabGroupId?: string
}

export interface BrowserToolRegistrationOptions {
  outputFileAccess?: BrowserOutputFileAccess
  onToolExecuted?: (event: BrowserToolExecutionEvent) => void
  /** Called after a tool actually runs (post-gate). Used for context-graph ingest. */
  onToolSettled?: (info: {
    toolName: string
    args: Record<string, unknown>
    result: { content: unknown; isError?: boolean }
  }) => void
  shouldLogToolRegistration?: () => boolean
  logger?: { info(message: string): void }
  source?: string
  gateContext?: GateContext
}

export interface BrowserToolExecutionEvent extends Record<string, unknown> {
  tool_name: string
  duration_ms: number
  success: boolean
  source: string
  error_message?: string
}

/** Registers the browser tool surface on an MCP server bound to one BrowserSession. */
export function registerBrowserTools(
  server: McpServer,
  session: BrowserSession,
  defaults: BrowserToolDefaults = {},
  options: BrowserToolRegistrationOptions = {},
): void {
  const register = server.registerTool.bind(server) as unknown as RegisterFn

  for (const tool of BROWSER_TOOLS) {
    register(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.input.shape,
        ...(tool.output && { outputSchema: tool.output.shape }),
        ...(tool.annotations && {
          annotations: tool.annotations as Record<string, unknown>,
        }),
      },
      async (args, extra) => {
        const startTime = performance.now()
        const duration = () => Math.round(performance.now() - startTime)

        const runTool = async (cleanArgs: Record<string, unknown>) => {
          try {
            const result = await withBrowserOutputFileAccess(
              options.outputFileAccess,
              () =>
                executeTool(tool, cleanArgs, {
                  session,
                  ...defaults,
                  signal: extra?.signal,
                }),
            )
            options.onToolExecuted?.({
              tool_name: tool.name,
              duration_ms: duration(),
              success: !result.isError,
              source: options.source ?? 'mcp',
            })
            const settled = {
              content: result.content,
              isError: result.isError,
              structuredContent: result.structuredContent,
            }
            options.onToolSettled?.({
              toolName: tool.name,
              args: cleanArgs,
              result: settled,
            })
            return settled
          } catch (error) {
            const errorText =
              error instanceof Error ? error.message : String(error)
            options.onToolExecuted?.({
              tool_name: tool.name,
              duration_ms: duration(),
              success: false,
              error_message: errorText,
              source: options.source ?? 'mcp',
            })
            return {
              content: [{ type: 'text' as const, text: errorText }],
              isError: true,
            }
          }
        }

        if (options.gateContext) {
          return gateMcpHandler(tool.name, args, options.gateContext, runTool)
        }

        return runTool(args)
      },
    )
  }

  if (options.shouldLogToolRegistration?.()) {
    options.logger?.info(
      `Registered ${BROWSER_TOOLS.length} browser tools: ${BROWSER_TOOLS.map((t) => t.name).join(', ')}`,
    )
  }
}
