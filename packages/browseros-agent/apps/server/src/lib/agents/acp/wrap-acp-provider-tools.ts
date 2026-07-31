/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * acpx-ai-provider emits provider-executed tool-call parts with titles like
 * `Tool: browseros/pi_read` and without `dynamic: true`. AI SDK then throws
 * AI_NoSuchToolError (title not in the ToolLoopAgent set). Rewrite stream /
 * generate parts so MCP tools are accepted as provider-executed dynamic
 * tools and titles match bare registry names when possible.
 */

import type { LanguageModel } from 'ai'
import { normalizeAcpToolTitle } from './tool-title'

type ToolishPart = {
  type: string
  toolName?: string
  providerExecuted?: boolean
  dynamic?: boolean
  [key: string]: unknown
}

function rewriteToolishPart<T extends ToolishPart>(part: T): T {
  if (
    part.type !== 'tool-call' &&
    part.type !== 'tool-result' &&
    part.type !== 'tool-input-start'
  ) {
    return part
  }

  const next: T = { ...part }
  if (typeof next.toolName === 'string') {
    next.toolName = normalizeAcpToolTitle(next.toolName)
  }
  if (next.providerExecuted) {
    next.dynamic = true
  }
  return next
}

function rewriteContentParts(content: unknown): unknown {
  if (!Array.isArray(content)) return content
  return content.map((part) => {
    if (!part || typeof part !== 'object') return part
    return rewriteToolishPart(part as ToolishPart)
  })
}

function rewriteStreamPart(part: unknown): unknown {
  if (!part || typeof part !== 'object') return part
  return rewriteToolishPart(part as ToolishPart)
}

/**
 * Wrap an ACP LanguageModel so provider-executed MCP tool parts survive AI
 * SDK tool validation. Safe no-op for models without doStream/doGenerate.
 */
export function wrapAcpProviderExecutedTools(
  model: LanguageModel,
): LanguageModel {
  if (
    typeof model !== 'object' ||
    model === null ||
    !('doStream' in model) ||
    typeof (model as { doStream?: unknown }).doStream !== 'function'
  ) {
    return model
  }

  const base = model as LanguageModel & {
    doStream: (...args: unknown[]) => Promise<{
      stream: ReadableStream<unknown>
      [key: string]: unknown
    }>
    doGenerate?: (...args: unknown[]) => Promise<{
      content?: unknown
      [key: string]: unknown
    }>
  }

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'doStream') {
        return async (...args: unknown[]) => {
          const result = await target.doStream(...args)
          return {
            ...result,
            stream: result.stream.pipeThrough(
              new TransformStream({
                transform(chunk, controller) {
                  controller.enqueue(rewriteStreamPart(chunk))
                },
              }),
            ),
          }
        }
      }
      if (prop === 'doGenerate' && typeof target.doGenerate === 'function') {
        const doGenerate = target.doGenerate.bind(target)
        return async (...args: unknown[]) => {
          const result = await doGenerate(...args)
          return {
            ...result,
            content: rewriteContentParts(result.content),
          }
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as LanguageModel
}
