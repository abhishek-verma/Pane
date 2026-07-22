/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { UIMessage } from 'ai'
import type { ToolImageStore } from './session-store'

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
          const toolName = part.type.slice(5)
          if (!toolNames.has(toolName)) return false
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
 * Returns `true` when any image data was moved to the store.
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
      if (!Array.isArray(rec.content)) continue
      let stripped = false
      const newContent = (rec.content as unknown[]).map((item) => {
        if (
          typeof item !== 'object' ||
          item === null ||
          (item as Record<string, unknown>).type !== 'image'
        ) {
          return item
        }
        const imgPart = item as Record<string, unknown>
        if (imgPart.stripped === true) return item
        const data = imgPart.data
        const mimeType = imgPart.mimeType ?? imgPart.mediaType
        const toolCallId = anyPart.toolCallId
        if (
          typeof data === 'string' &&
          data.length > 0 &&
          typeof mimeType === 'string' &&
          typeof toolCallId === 'string'
        ) {
          imageStore.store(sessionId, toolCallId, data, mimeType)
          stripped = true
          // Return the item without the data field; keep type/mimeType for
          // the UI to detect and lazy-load.
          const { data: _removed, ...rest } = imgPart
          return { ...rest, stripped: true }
        }
        return item
      })
      if (stripped) {
        anyPart.output = { ...rec, content: newContent }
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
