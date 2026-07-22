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
import type { ToolImageStore } from './session-store'
import {
  rehydrateImagesForModel,
  stripAndStoreImages,
} from './tool-image-strip'

export interface BrowserToolSetOptions {
  readOnly?: boolean
  outputFileAccess?: BrowserOutputFileAccess
  /** Conversation id used as ToolImageStore session key. */
  sessionId?: string
  /** When set, tool results store image blobs and return stripped UI content. */
  imageStore?: ToolImageStore
}

interface ToolExecuteOptions {
  abortSignal?: AbortSignal
  toolCallId?: string
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
  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'media'; data: string; mediaType: string }
  > = []
  for (const c of content) {
    if (c.type === 'text') {
      parts.push({ type: 'text', text: c.text })
      continue
    }
    if (c.type === 'image' && typeof c.data === 'string' && c.data.length > 0) {
      parts.push({
        type: 'media',
        data: c.data,
        mediaType: c.mimeType,
      })
    }
    // Image without bytes (stripped / missing): omit — never invent stub text.
  }

  const hasImages = parts.some((p) => p.type === 'media')
  if (!hasImages) {
    const text = parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
    return { type: 'text', value: text || 'Success' }
  }
  return { type: 'content', value: parts }
}

/** Maps browser-mcp ToolResult into the AI SDK tool execute return shape. */
export function toBrowserToolExecuteResult(
  result: BrowserToolResult,
  options?: {
    sessionId: string
    toolCallId: string
    imageStore: ToolImageStore
  },
) {
  const content =
    options && result.content?.length
      ? stripAndStoreImages(result.content, options)
      : result.content
  return {
    content,
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
  const { sessionId, imageStore } = options

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

        const toolCallId = executeOptions?.toolCallId
        if (sessionId && imageStore && toolCallId) {
          return toBrowserToolExecuteResult(result, {
            sessionId,
            toolCallId,
            imageStore,
          })
        }
        return toBrowserToolExecuteResult(result)
      },
      toModelOutput: ({ toolCallId, output }) => {
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
        const forModel =
          imageStore && toolCallId
            ? rehydrateImagesForModel(result.content, {
                toolCallId,
                imageStore,
              })
            : result.content
        return contentToModelOutput(forModel)
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
