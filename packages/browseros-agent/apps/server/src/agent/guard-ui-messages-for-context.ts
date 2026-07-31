/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Pre-turn size guard for mega transcripts. Compaction runs in prepareStep
 * after convertToModelMessages; some providers fail earlier with opaque
 * errors when the UIMessage payload is already huge. Truncating fat tool
 * outputs here keeps continue/resume workable without waiting on that path.
 */

import { AGENT_LIMITS } from '@browseros/shared/constants/limits'
import type { UIMessage } from 'ai'

const DEFAULT_TRIGGER_CHARS = 200_000

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars for context]`
}

/**
 * If the transcript JSON is over `triggerChars`, truncate oversized tool
 * output bodies in a clone (or in-place when unchanged refs suffice).
 * Returns the messages to use for the next model turn.
 */
export function guardUiMessagesForContext(
  messages: UIMessage[],
  options?: {
    triggerChars?: number
    previewMaxChars?: number
  },
): { messages: UIMessage[]; truncated: boolean; approxChars: number } {
  const triggerChars = options?.triggerChars ?? DEFAULT_TRIGGER_CHARS
  const previewMaxChars =
    options?.previewMaxChars ?? AGENT_LIMITS.COMPACTION_TOOL_OUTPUT_MAX_CHARS

  let approxChars = 0
  try {
    approxChars = JSON.stringify(messages).length
  } catch {
    approxChars = Number.POSITIVE_INFINITY
  }

  if (approxChars <= triggerChars) {
    return { messages, truncated: false, approxChars }
  }

  let anyChanged = false
  const next = messages.map((msg) => {
    let partsChanged = false
    const parts = msg.parts.map((part) => {
      if (typeof part.type !== 'string' || !part.type.startsWith('tool-')) {
        return part
      }
      const anyPart = part as Record<string, unknown>
      const output = anyPart.output
      if (!output || typeof output !== 'object') return part
      const rec = output as Record<string, unknown>
      let outChars = 0
      try {
        outChars = JSON.stringify(output).length
      } catch {
        outChars = previewMaxChars * 4
      }
      if (outChars <= previewMaxChars * 2) return part

      anyChanged = true
      partsChanged = true
      const content = Array.isArray(rec.content) ? [...rec.content] : null
      const nextContent =
        content?.map((item) => {
          if (typeof item !== 'object' || item === null) return item
          const block = item as Record<string, unknown>
          if (block.type === 'text' && typeof block.text === 'string') {
            return { ...block, text: truncateText(block.text, previewMaxChars) }
          }
          if (block.type === 'image' && typeof block.data === 'string') {
            const { data: _d, ...rest } = block
            return { ...rest, stripped: true }
          }
          return item
        }) ?? rec.content

      let structuredContent = rec.structuredContent
      if (
        structuredContent &&
        typeof structuredContent === 'object' &&
        !Array.isArray(structuredContent)
      ) {
        const sc = { ...(structuredContent as Record<string, unknown>) }
        if (typeof sc.snapshot === 'string') {
          sc.snapshot = truncateText(sc.snapshot, previewMaxChars)
        }
        if (typeof sc.image === 'string') delete sc.image
        structuredContent = sc
      }

      return {
        ...anyPart,
        output: {
          ...rec,
          content: nextContent,
          structuredContent,
          preview:
            typeof rec.preview === 'string'
              ? truncateText(rec.preview, previewMaxChars)
              : rec.preview,
        },
      } as typeof part
    })
    if (!partsChanged) return msg
    return { ...msg, parts }
  })

  return {
    messages: anyChanged ? next : messages,
    truncated: anyChanged,
    approxChars,
  }
}
