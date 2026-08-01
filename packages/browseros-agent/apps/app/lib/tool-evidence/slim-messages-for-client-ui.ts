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

/** Size estimate that never JSON.stringify's image `data` fields. */
export function estimateToolOutputBytes(value: unknown): number {
  if (value == null) return 0
  if (typeof value === 'string') return value.length
  if (typeof value !== 'object') return 8
  if (Array.isArray(value)) {
    let n = 0
    for (const item of value) n += estimateToolOutputBytes(item)
    return n
  }
  const rec = value as Record<string, unknown>
  if (rec.type === 'image' && typeof rec.data === 'string') {
    return rec.data.length + 32
  }
  let n = 0
  for (const [k, v] of Object.entries(rec)) {
    n += k.length
    if (k === 'data' && typeof v === 'string' && rec.type === 'image') {
      n += v.length
      continue
    }
    if (k === 'image' && typeof v === 'string') {
      n += v.length
      continue
    }
    n += estimateToolOutputBytes(v)
  }
  return n
}

function firstTextPreview(
  rec: Record<string, unknown>,
  maxChars: number,
): string {
  if (typeof rec.preview === 'string' && rec.preview) {
    return truncateText(rec.preview, maxChars)
  }
  if (Array.isArray(rec.content)) {
    for (const item of rec.content) {
      if (typeof item !== 'object' || item === null) continue
      const block = item as Record<string, unknown>
      if (block.type === 'text' && typeof block.text === 'string') {
        return truncateText(block.text, maxChars)
      }
    }
  }
  return ''
}

/**
 * Returns the same reference when nothing needs shrinking; otherwise a new
 * messages array with truncated tool previews for renderer memory.
 */
export function slimMessagesForClientUi(
  messages: UIMessage[],
  previewMaxChars: number = AGENT_LIMITS.UI_TOOL_OUTPUT_PREVIEW_MAX_CHARS,
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
      // Server already spilled — leave the stub alone (still strip images).
      const structured = rec.structuredContent
      const sc =
        structured &&
        typeof structured === 'object' &&
        !Array.isArray(structured)
          ? (structured as Record<string, unknown>)
          : null

      let hasInlineImage = false
      if (Array.isArray(rec.content)) {
        for (const item of rec.content) {
          if (
            item &&
            typeof item === 'object' &&
            (item as { type?: string; data?: unknown; stripped?: boolean })
              .type === 'image' &&
            typeof (item as { data?: unknown }).data === 'string' &&
            (item as { stripped?: boolean }).stripped !== true
          ) {
            hasInlineImage = true
            break
          }
        }
      }
      if (sc && typeof sc.image === 'string' && sc.image.length > 0) {
        hasInlineImage = true
      }

      if (rec.spilled === true && !hasInlineImage) return part

      const bytes = estimateToolOutputBytes(output)
      const fatSnapshot =
        sc &&
        typeof sc.snapshot === 'string' &&
        sc.snapshot.length > previewMaxChars
      if (bytes <= previewMaxChars * 2 && !fatSnapshot && !hasInlineImage) {
        return part
      }

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
          if (block.type === 'image') {
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
        preview = firstTextPreview(
          { ...rec, content: nextContent },
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
