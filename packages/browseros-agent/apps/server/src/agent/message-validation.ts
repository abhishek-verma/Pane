/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { UIMessage } from 'ai'
import type { ToolImageStore } from './session-store'

// ACP-backed providers (Claude Code, etc.) persist tool-call history with a
// server-name prefix — `mcp__browseros__pi_open`, `mcp.browseros.navigate`
// — instead of the bare name the in-process toolset registers. Without
// stripping it, sanitizeMessagesForToolset() below treats every ACP-sourced
// tool part as unknown and silently drops it from history on the next
// rebuild (e.g. a mid-conversation provider switch).
const MCP_TOOL_PREFIX_RE = /^mcp[._]+[a-z0-9-]+[._]+/i

function bareToolName(name: string): string {
  return name.replace(MCP_TOOL_PREFIX_RE, '')
}

/**
 * Checks whether a UIMessage has meaningful content that can be sent
 * to the AI provider without causing validation errors.
 *
 * Two layers of validation can reject messages:
 *
 * 1. **AI SDK** (`validate-ui-messages.ts`):
 *    - `parts` array must be `.nonempty()` — rejects `parts: []`
 *
 * 2. **Provider API** (e.g. Gemini `generateContent`, Anthropic, OpenAI):
 *    - Assistant messages with only empty-string text are rejected
 *      as semantically empty, even though the SDK schema allows it
 *
 * This function guards against both layers so callers can filter
 * messages before passing them to `createAgentUIStreamResponse`.
 */
export function hasMessageContent(message: UIMessage): boolean {
  if (message.parts.length === 0) return false

  // A message that contains any non-text part (tool invocation, reasoning,
  // file, step-start, etc.) is always considered valid — those part types
  // carry meaning regardless of text content.
  const hasNonTextPart = message.parts.some((p) => p.type !== 'text')
  if (hasNonTextPart) return true

  // All parts are text — at least one must have non-whitespace content.
  return message.parts.some(
    (p) => p.type === 'text' && p.text.trim().length > 0,
  )
}

/**
 * Filters a UIMessage array, removing messages that would fail
 * SDK validation or provider-level content checks.
 */
export function filterValidMessages(messages: UIMessage[]): UIMessage[] {
  return messages.filter(hasMessageContent)
}

/**
 * Remove tool parts that reference tools not present in the given toolset.
 *
 * When a session is rebuilt with a different set of tools (e.g., workspace
 * removed mid-conversation or MCP server disconnected), the carried-over
 * message history may contain tool parts for tools that no longer exist.
 * The AI SDK validates messages against the current toolset and rejects
 * parts with no matching schema.
 *
 * Tool parts use the type format `tool-${toolName}` (static tools) or
 * `dynamic-tool` (dynamic tools). This function filters out static tool
 * parts whose tool name is not in the provided set.
 */
export function sanitizeMessagesForToolset(
  messages: UIMessage[],
  toolNames: Set<string>,
): UIMessage[] {
  return messages
    .map((msg) => {
      const filteredParts = msg.parts.filter((part) => {
        // Static tool parts have type `tool-${toolName}`
        if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
          const toolName = bareToolName(part.type.slice(5))
          if (!toolNames.has(toolName)) return false
        }
        // Dynamic (MCP) tool parts carry the name in `toolName` instead of
        // the discriminated `type` — a disconnected MCP server leaves these
        // behind the same way a removed static tool does.
        if (part.type === 'dynamic-tool') {
          const toolName = (part as { toolName?: string }).toolName
          if (
            typeof toolName === 'string' &&
            !toolNames.has(bareToolName(toolName))
          ) {
            return false
          }
        }
        return true
      })

      if (filteredParts.length === msg.parts.length) return msg
      return { ...msg, parts: filteredParts }
    })
    .filter(hasMessageContent)
}

/**
 * Strips base64 image data from UIMessage tool-output parts, persisting each
 * stripped image to `imageStore` so the UI can lazy-load via the tool-images API.
 *
 * All assistant/tool image outputs are stripped immediately (no keep-recent
 * window). Recent thumbs are lazy-loaded from the tool-images API.
 *
 * Also removes legacy `structuredContent.image` duplicates.
 *
 * Returns `true` when any image data was moved/removed.
 *
 * The function mutates `messages` **in-place** so `session.agent.messages` is
 * also updated without requiring a reference swap at the call site.
 */
export function stripUIImageOutputs(
  messages: UIMessage[],
  sessionId: string,
  imageStore: ToolImageStore,
): boolean {
  let anyStripped = false

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (typeof part.type !== 'string' || !part.type.startsWith('tool-'))
        continue
      // AI SDK tool parts are typed as specific discriminated unions; use
      // unknown cast to access the output field safely.
      const anyPart = part as Record<string, unknown>
      const output = anyPart.output
      if (!output || typeof output !== 'object') continue
      const rec = output as Record<string, unknown>
      let outputChanged = false
      let nextRec = rec

      if (Array.isArray(rec.content)) {
        let contentStripped = false
        const newContent: unknown[] = []
        for (const item of rec.content as unknown[]) {
          if (
            typeof item !== 'object' ||
            item === null ||
            (item as Record<string, unknown>).type !== 'image'
          ) {
            newContent.push(item)
            continue
          }
          const imgPart = item as Record<string, unknown>
          if (imgPart.stripped === true) {
            newContent.push(item)
            continue
          }
          const data = imgPart.data
          const mimeType = imgPart.mimeType ?? imgPart.mediaType
          const toolCallId = anyPart.toolCallId
          if (
            typeof data === 'string' &&
            data.length > 0 &&
            typeof mimeType === 'string' &&
            typeof toolCallId === 'string'
          ) {
            contentStripped = true
            if (imageStore.store(sessionId, toolCallId, data, mimeType)) {
              const { data: _removed, ...rest } = imgPart
              newContent.push({ ...rest, stripped: true })
            }
            // Store failed: omit the image so we never leave fat bytes or a
            // dead lazy-load placeholder in UIMessage state.
            continue
          }
          // Incomplete image part without usable bytes — omit.
          if (typeof data === 'string' && data.length > 0) {
            contentStripped = true
            continue
          }
          newContent.push(item)
        }
        if (contentStripped) {
          nextRec = { ...nextRec, content: newContent }
          outputChanged = true
        }
      }

      // Legacy screenshot payloads duplicated base64 under structuredContent.image.
      const structured = nextRec.structuredContent
      if (
        structured &&
        typeof structured === 'object' &&
        !Array.isArray(structured)
      ) {
        const sc = structured as Record<string, unknown>
        if (typeof sc.image === 'string' && sc.image.length > 0) {
          const toolCallId = anyPart.toolCallId
          const mimeType =
            typeof sc.format === 'string' ? `image/${sc.format}` : 'image/jpeg'
          if (typeof toolCallId === 'string') {
            imageStore.store(sessionId, toolCallId, sc.image, mimeType)
          }
          // Always drop the duplicate base64 from structuredContent (OOM risk),
          // whether or not the blob store write succeeded.
          const { image: _dup, ...rest } = sc
          nextRec = { ...nextRec, structuredContent: rest }
          outputChanged = true
        }
      }

      if (outputChanged) {
        anyPart.output = nextRec
        anyStripped = true
      }
    }
  }

  return anyStripped
}

/** Approximate serialized size of messages for poison-session gates. */
export function estimateMessagesJsonBytes(messages: UIMessage[]): number {
  try {
    return JSON.stringify(messages).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}
