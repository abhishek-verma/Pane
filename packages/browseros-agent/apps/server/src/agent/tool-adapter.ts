import type { LanguageModelV2ToolResultOutput } from '@ai-sdk/provider'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import {
  type BrowserOutputFileAccess,
  withBrowserOutputFileAccess,
} from '@browseros/browser-mcp/output-file'
import { BROWSER_TOOLS } from '@browseros/browser-mcp/registry'
import {
  type ToolDefinition as BrowserToolDefinition,
  type ToolResult as BrowserToolResult,
  type ContentBlock,
  errorResult,
  executeTool as executeBrowserTool,
  throwIfAborted,
} from '@browseros/browser-mcp/tools/framework'
import { type ToolSet, tool } from 'ai'
import { metrics } from '../lib/metrics'

export interface BrowserToolSetOptions {
  readOnly?: boolean
  outputFileAccess?: BrowserOutputFileAccess
}

interface ToolExecuteOptions {
  abortSignal?: AbortSignal
}

const BROWSER_TOOL_TIMEOUT_MS = 120_000

function withBrowserToolTimeout(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(BROWSER_TOOL_TIMEOUT_MS)
  if (!signal) return timeoutSignal

  const controller = new AbortController()
  const forwardAbort = (source: AbortSignal) => {
    if (source.aborted) {
      controller.abort(source.reason)
      return
    }
    source.addEventListener('abort', () => controller.abort(source.reason), {
      once: true,
    })
  }

  forwardAbort(signal)
  forwardAbort(timeoutSignal)
  return controller.signal
}

function contentToModelOutput(
  content: ContentBlock[],
): LanguageModelV2ToolResultOutput {
  const hasImages = content.some((c) => c.type === 'image')
  if (!hasImages) {
    const text = content
      .filter((c): c is ContentBlock & { type: 'text' } => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
    return { type: 'text', value: text || 'Success' }
  }
  return {
    type: 'content',
    value: content.map((c) =>
      c.type === 'text'
        ? { type: 'text' as const, text: c.text }
        : { type: 'media' as const, data: c.data, mediaType: c.mimeType },
    ),
  }
}

/** Maps browser-mcp ToolResult into the AI SDK tool execute return shape. */
export function toBrowserToolExecuteResult(result: BrowserToolResult) {
  return {
    content: result.content,
    isError: result.isError ?? false,
    ...(result.structuredContent !== undefined && {
      structuredContent: result.structuredContent,
    }),
  }
}

/** Wraps the browser-core tool surface as AI SDK tools for the internal agent. */
export function buildBrowserToolSet(
  session: BrowserSession,
  options: BrowserToolSetOptions = {},
): ToolSet {
  const toolSet: ToolSet = {}

  for (const def of BROWSER_TOOLS) {
    toolSet[def.name] = tool({
      description: def.description,
      inputSchema: def.input,
      execute: async (params, executeOptions?: ToolExecuteOptions) => {
        const startTime = performance.now()
        const signal = withBrowserToolTimeout(executeOptions?.abortSignal)
        throwIfAborted(signal)

        while (!session.isConnected()) {
          throwIfAborted(signal)
          await new Promise((resolve) => setTimeout(resolve, 500))
        }

        let result: BrowserToolResult | null = null
        while (true) {
          result =
            readOnlyGuard(def, params, options) ??
            (await withBrowserOutputFileAccess(options.outputFileAccess, () =>
              executeBrowserTool(def, params as Record<string, unknown>, {
                session,
                signal,
              }),
            ))

          // If the tool failed because the target crashed or disconnected, pause and retry
          if (
            result.isError &&
            result.content.some(
              (c) =>
                c.type === 'text' &&
                (c.text.includes('Target closed') ||
                  c.text.includes('CDP connection lost') ||
                  c.text.includes('Session closed')),
            )
          ) {
            // Wait for reconnect
            await new Promise((resolve) => setTimeout(resolve, 1000))
            while (!session.isConnected()) {
              throwIfAborted(signal)
              await new Promise((resolve) => setTimeout(resolve, 500))
            }
            continue
          }
          break
        }

        metrics.log('tool_executed', {
          tool_name: def.name,
          duration_ms: Math.round(performance.now() - startTime),
          success: !result.isError,
          source: 'chat',
        })
        return toBrowserToolExecuteResult(result)
      },
      toModelOutput: ({ output }) => {
        const result = output as { content: ContentBlock[]; isError: boolean }
        if (result.isError) {
          const text = result.content
            .filter(
              (c): c is ContentBlock & { type: 'text' } => c.type === 'text',
            )
            .map((c) => c.text)
            .join('\n')
          return { type: 'error-text', value: text }
        }
        if (!result.content?.length) {
          return { type: 'text', value: 'Success' }
        }
        return contentToModelOutput(result.content)
      },
    })
  }

  return toolSet
}

function readOnlyGuard(
  def: BrowserToolDefinition,
  params: unknown,
  options: BrowserToolSetOptions,
): BrowserToolResult | null {
  if (!options.readOnly || def.name !== 'tabs') return null
  const action =
    params &&
    typeof params === 'object' &&
    'action' in params &&
    typeof params.action === 'string'
      ? params.action
      : 'list'
  if (action === 'list' || action === 'active') return null
  return errorResult('tabs: chat mode only supports action="list" or "active".')
}
