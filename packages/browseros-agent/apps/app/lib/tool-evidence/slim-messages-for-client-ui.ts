/**
 * Client-side UI memory bound for live useChat state.
 * Truncates fat tool outputs in a clone; does not touch server/agent fidelity.
 *
 * Does **not** set `spilled: true` — that flag means the full body lives in
 * ToolOutputStore and expand can fetch `/tool-outputs`. Client-only truncation
 * keeps a short preview inline so cloud restore / early stream frames do not
 * 404 on expand.
 */

import { AGENT_LIMITS } from '@browseros/shared/constants/limits'
import type { UIMessage } from 'ai'

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`
}

function estimateBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/**
 * Returns the same reference when nothing needs shrinking; otherwise a new
 * messages array with truncated tool previews for renderer memory.
 */
export function slimMessagesForClientUi(
  messages: UIMessage[],
  previewMaxChars = AGENT_LIMITS.UI_TOOL_OUTPUT_PREVIEW_MAX_CHARS,
): UIMessage[] {
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
      // Server already spilled — leave the stub alone.
      if (rec.spilled === true) return part

      const bytes = estimateBytes(output)
      const structured = rec.structuredContent
      const sc =
        structured &&
        typeof structured === 'object' &&
        !Array.isArray(structured)
          ? (structured as Record<string, unknown>)
          : null
      const fatSnapshot =
        sc &&
        typeof sc.snapshot === 'string' &&
        sc.snapshot.length > previewMaxChars
      if (bytes <= previewMaxChars * 2 && !fatSnapshot) return part

      anyChanged = true
      partsChanged = true
      const content = Array.isArray(rec.content) ? [...rec.content] : null
      let preview = typeof rec.preview === 'string' ? rec.preview : ''
      const nextContent =
        content?.map((item) => {
          if (typeof item !== 'object' || item === null) return item
          const block = item as Record<string, unknown>
          if (block.type === 'text' && typeof block.text === 'string') {
            const truncated = truncateText(block.text, previewMaxChars)
            if (!preview) preview = truncated
            return { ...block, text: truncated }
          }
          if (block.type === 'image' && typeof block.data === 'string') {
            const { data: _d, ...rest } = block
            return { ...rest, stripped: true }
          }
          return item
        }) ?? rec.content

      let structuredContent = rec.structuredContent
      if (sc) {
        const nextSc = { ...sc }
        if (typeof nextSc.snapshot === 'string') {
          nextSc.snapshotPreview = truncateText(
            nextSc.snapshot,
            previewMaxChars,
          )
          nextSc.snapshotContentLength = nextSc.snapshot.length
          delete nextSc.snapshot
        }
        if (typeof nextSc.image === 'string') delete nextSc.image
        structuredContent = nextSc
      }
      if (!preview) {
        preview = truncateText(
          JSON.stringify(rec).slice(0, previewMaxChars * 2),
          previewMaxChars,
        )
      }

      return {
        ...anyPart,
        output: {
          ...rec,
          content: nextContent,
          structuredContent,
          preview,
          contentLength: bytes,
        },
      } as typeof part
    })
    if (!partsChanged) return msg
    return { ...msg, parts }
  })
  return anyChanged ? next : messages
}
