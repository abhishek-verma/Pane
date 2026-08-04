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
 *
 * acpx-ai-provider (0.0.6) also has an unrelated bug: its ACP tool_call
 * handler treats the human-readable status/content text ACP sends per
 * update (e.g. "Terminal (pending)", then the command, then the rendered
 * result) as if it were incremental JSON forming the tool's `input`, and
 * its prefix-based dedupe (`text.startsWith(emittedText) ? slice : text`)
 * appends the whole new status instead of replacing it whenever a status
 * update isn't a strict growing prefix of the last one — which ACP status
 * text never is. The finalized `tool-call.input` ends up as that garbled,
 * non-JSON blob. AI SDK's parseProviderExecutedDynamicToolCall then does
 * `JSON.parse(toolCall.input)` and throws AI_InvalidToolInputError,
 * surfacing as a confusing stream error even though the underlying ACP
 * tool call actually completed. Repair `input` here too, at the same
 * interception point, rather than waiting on an upstream fix.
 */

import type { LanguageModel } from 'ai'
import { normalizeAcpToolTitle } from './tool-title'

type ToolishPart = {
  type: string
  toolName?: string
  providerExecuted?: boolean
  dynamic?: boolean
  input?: unknown
  [key: string]: unknown
}

/**
 * `tool-call.input` must be a JSON string (or empty) — AI SDK JSON.parses
 * it for provider-executed dynamic tools. acpx-ai-provider can hand us
 * arbitrary ACP status text instead. Leave valid JSON and blank/whitespace
 * input untouched (AI SDK already treats blank as `{}`); wrap anything
 * else as `{"description": "<original text>"}` so parsing never throws
 * and the original text is still visible in the tool call's rendered input.
 */
function sanitizeToolCallInput(input: unknown): unknown {
  if (typeof input !== 'string' || input.trim() === '') return input
  try {
    JSON.parse(input)
    return input
  } catch {
    return JSON.stringify({ description: input })
  }
}

/**
 * The acpx-ai-provider bundles ACP status traces into `tool-result.result`
 * as a plain string: `<toolName> (pending)…tool call (completed): <json>`.
 *
 * We only attempt extraction when the string starts with `<toolName> (pending)`
 * — that prefix is unique to the acpx-ai-provider trace format and guards
 * against misfiring on legitimate tool results that incidentally contain
 * the `completed): ` substring.
 */
function sanitizeToolResult(result: unknown, toolName?: string): unknown {
  if (typeof result !== 'string') return result
  try {
    JSON.parse(result)
    return result
  } catch {
    // Guard: only process strings that look like acpx-ai-provider traces.
    // Require the string to begin with "<toolName> (pending)" so we don't
    // misinterpret plain-text results that happen to contain "completed): ".
    if (!toolName || !result.startsWith(`${toolName} (pending)`)) {
      return { description: result }
    }
    const marker = 'tool call (completed): '
    const idx = result.lastIndexOf(marker)
    if (idx !== -1) {
      const candidate = result.slice(idx + marker.length)
      try {
        JSON.parse(candidate)
        return { text: candidate }
      } catch {
        // fall through
      }
    }
    return { description: result }
  }
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
  if (part.type === 'tool-call') {
    next.input = sanitizeToolCallInput(next.input)
  }
  if (part.type === 'tool-result') {
    ;(next as ToolishPart).result = sanitizeToolResult(
      (next as ToolishPart).result,
      typeof next.toolName === 'string' ? next.toolName : undefined,
    )
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
