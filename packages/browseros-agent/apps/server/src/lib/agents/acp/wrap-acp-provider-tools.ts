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

function rewriteStreamPart(part: unknown): unknown {
  if (!part || typeof part !== 'object') return part
  return rewriteToolishPart(part as ToolishPart)
}

/**
 * Mirrors acpx-ai-provider's own `accumulateStream` (dist/index.js) so
 * `doGenerate` can be served from our error-suppressing, tool-rewriting
 * `doStream` instead of acpx's raw one. acpx's `doGenerate` is defined as
 * `async doGenerate(o) { const { stream } = await this.doStream(o); return
 * accumulateStream(stream, ...) }` — called as `this.doStream`, which
 * resolves to acpx's own unwrapped method (not this module's Proxy trap),
 * so routing through `target.doGenerate` directly would bypass the error
 * fix above entirely for any caller using `generateText`/`doGenerate`
 * against this model (e.g. `experimental_repairToolCall`).
 *
 * acpx-ai-provider doesn't export `accumulateStream`, so this is a
 * hand-copy pinned to the `acpx-ai-provider@0.0.6` shape. Re-diff against
 * `accumulateStream`/`applyPart` in its `dist/index.js` on any
 * acpx-ai-provider version bump.
 */
async function accumulateRewrittenStream(
  stream: ReadableStream<unknown>,
  request: unknown,
  response: unknown,
): Promise<{
  content: unknown[]
  finishReason: unknown
  usage: unknown
  providerMetadata?: unknown
  request: unknown
  response: unknown
  warnings: unknown[]
}> {
  const content: unknown[] = []
  const textBuffers = new Map<string, string>()
  const reasoningBuffers = new Map<string, string>()
  let finishReason: unknown = 'unknown'
  let usage: unknown = {
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined,
  }
  let providerMetadata: unknown

  const flushBuffer = (
    map: Map<string, string>,
    id: string,
    type: 'text' | 'reasoning',
  ) => {
    const value = map.get(id) ?? ''
    if (value) content.push({ type, text: value })
    map.delete(id)
  }

  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const part = value as ToolishPart
      switch (part.type) {
        case 'text-start':
          textBuffers.set(part.id as string, '')
          break
        case 'text-delta':
          textBuffers.set(
            part.id as string,
            (textBuffers.get(part.id as string) ?? '') + (part.delta as string),
          )
          break
        case 'text-end':
          flushBuffer(textBuffers, part.id as string, 'text')
          break
        case 'reasoning-start':
          reasoningBuffers.set(part.id as string, '')
          break
        case 'reasoning-delta':
          reasoningBuffers.set(
            part.id as string,
            (reasoningBuffers.get(part.id as string) ?? '') +
              (part.delta as string),
          )
          break
        case 'reasoning-end':
          flushBuffer(reasoningBuffers, part.id as string, 'reasoning')
          break
        case 'tool-call':
          content.push({
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
            providerExecuted: part.providerExecuted,
            dynamic: part.dynamic,
            ...(part.providerMetadata
              ? { providerMetadata: part.providerMetadata }
              : {}),
          })
          break
        case 'tool-result':
          content.push({
            type: 'tool-result',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            result: part.result,
            providerExecuted: part.providerExecuted,
            dynamic: part.dynamic,
            ...((part as { isError?: boolean }).isError
              ? { isError: true }
              : {}),
            ...(part.providerMetadata
              ? { providerMetadata: part.providerMetadata }
              : {}),
          })
          break
        case 'finish':
          // Fall back to the pre-seeded defaults above rather than clobbering
          // them with undefined if a finish chunk omits either field.
          finishReason =
            (part as { finishReason?: unknown }).finishReason ?? finishReason
          usage = (part as { usage?: unknown }).usage ?? usage
          if ((part as { providerMetadata?: unknown }).providerMetadata) {
            providerMetadata = (part as { providerMetadata?: unknown })
              .providerMetadata
          }
          break
        case 'error':
          throw part.error instanceof Error
            ? part.error
            : new Error(String((part as { error?: unknown }).error))
        default:
          break
      }
    }
  } finally {
    reader.releaseLock()
  }

  return {
    content,
    finishReason,
    usage,
    providerMetadata,
    request,
    response,
    warnings: [],
  }
}

/**
 * acpx-ai-provider (0.0.6) sets the whole ACP turn's `result.status` to
 * "failed" whenever any provider-native tool call inside it fails (e.g.
 * Claude Code's `Skill` tool erroring on an unregistered skill id), even
 * though that tool call already finalized normally as `tool-result {
 * isError: true }`. `createTranslatingStream` then *always* emits the
 * sequence `errorPartIfFailed(result)` (a stream-level `{ type: "error" }`
 * chunk) immediately followed by `finish({ result })` — see
 * acpx-ai-provider/dist/index.js's `createTranslatingStream` — regardless
 * of which tool call failed or how many other tool calls ran after it in
 * the same turn. The AI SDK treats any `error` chunk as fatal and throws,
 * killing the whole turn instead of letting the model see the tool error
 * and recover, which is how every other tool failure behaves.
 *
 * A genuine fatal error (dropped connection, etc.) is raised from the
 * `catch` block in the same function instead: it enqueues only the
 * `error` chunk and closes the stream with no `finish` behind it. So an
 * `error` chunk immediately followed by a `finish` chunk is always the
 * redundant, already-reported turn-failure case; an `error` chunk with no
 * `finish` behind it (stream just ends) is always the genuine case. This
 * buffers one `error` chunk at a time to make that lookahead decision
 * without depending on which specific tool-result preceded it.
 */
function createErrorGate(
  controller: TransformStreamDefaultController<unknown>,
) {
  let pendingError: unknown = null
  return {
    transform(chunk: unknown) {
      const part =
        chunk && typeof chunk === 'object' ? (chunk as ToolishPart) : null
      if (pendingError !== null) {
        const buffered = pendingError
        pendingError = null
        if (part?.type === 'finish') {
          // Redundant turn-level error immediately before finish — drop it,
          // let finish complete the turn normally.
          controller.enqueue(rewriteStreamPart(chunk))
          return
        }
        // Not immediately followed by finish — genuine error, forward it.
        controller.enqueue(buffered)
      }
      if (part?.type === 'error') {
        pendingError = chunk
        return
      }
      controller.enqueue(rewriteStreamPart(chunk))
    },
    flush() {
      // Stream ended right after the error with no finish behind it —
      // the genuine, non-tool-related fatal case. Forward it.
      if (pendingError !== null) controller.enqueue(pendingError)
    },
  }
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

  const wrappedDoStream: typeof base.doStream = async (...args: unknown[]) => {
    const result = await base.doStream(...args)
    let gate: ReturnType<typeof createErrorGate> | undefined
    return {
      ...result,
      stream: result.stream.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            gate ??= createErrorGate(controller)
            gate.transform(chunk)
          },
          flush() {
            gate?.flush()
          },
        }),
      ),
    }
  }

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'doStream') return wrappedDoStream
      if (prop === 'doGenerate' && typeof target.doGenerate === 'function') {
        // Route through our own error-suppressing, tool-rewriting doStream
        // rather than target.doGenerate — see accumulateRewrittenStream's
        // doc comment for why calling target.doGenerate directly would
        // bypass the fix.
        return async (...args: unknown[]) => {
          const { stream, request, response } = await wrappedDoStream(...args)
          return accumulateRewrittenStream(stream, request, response)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as LanguageModel
}
