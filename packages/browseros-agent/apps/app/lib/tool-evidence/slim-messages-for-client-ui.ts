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
import { boundMessagePayload } from './bound-message-payload'

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`
}

/** Size estimate that never JSON.stringify's image `data` fields. */
function estimateToolOutputBytes(value: unknown): number {
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
  const resident = boundMessagePayload(messages)
  let anyChanged = resident !== messages
  const next = resident.map((msg) => {
    let partsChanged = false
    const parts = msg.parts.map((part) => {
      if (
        typeof part.type !== 'string' ||
        (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-'))
      ) {
        return part
      }
      const anyPart = part as Record<string, unknown>
      const output = anyPart.output
      if (typeof output === 'string' && output.length > previewMaxChars) {
        anyChanged = true
        partsChanged = true
        return {
          ...part,
          output: {
            content: [
              { type: 'text', text: truncateText(output, previewMaxChars) },
            ],
            contentLength: output.length,
          },
        } as typeof part
      }
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
      // Pre-existing bug, fixed alongside the reasoning-part regression
      // above: `contentLength` is set (below) after this branch truncates
      // an output once. On a second pass, `bytes` re-counts the already-
      // shrunk `content` *and* the `preview` field together (preview is
      // itself a truncated near-duplicate of content) — their combined
      // size can sit above previewMaxChars*2 forever even though neither
      // field would actually change if reprocessed, so without this OR
      // clause the gate below never passes and this function never
      // returns the same reference for a large enough tool output. Called
      // from a useEffect that setMessages()s whenever the result differs
      // by reference, that non-convergence is an infinite render loop in
      // production (React error #185) — the same failure class as the
      // reasoning-part bug, just pre-existing rather than newly introduced.
      const alreadySlimmed = typeof rec.contentLength === 'number'
      if (
        (bytes <= previewMaxChars * 2 ||
          (alreadySlimmed && bytes <= previewMaxChars * 4)) &&
        !fatSnapshot &&
        !hasInlineImage
      ) {
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

      let boundedOutput: Record<string, unknown> = {
        ...rec,
        content: nextContent,
        structuredContent,
        preview,
        contentLength: bytes,
      }
      // MCP results may contain arbitrary nested JSON, arrays, or hundreds
      // of text blocks. Trimming each block alone does not bound the result.
      // Keep a readable preview without copying the large structured body.
      if (estimateToolOutputBytes(boundedOutput) > previewMaxChars * 4) {
        const text = truncateText(
          preview ||
            firstTextPreview(rec, previewMaxChars) ||
            '[Large tool result omitted from preview; full result is saved in chat history.]',
          previewMaxChars,
        )
        boundedOutput = {
          content: [{ type: 'text', text }],
          contentLength: bytes,
          ...(rec.isError === true ? { isError: true } : {}),
        }
      }
      return { ...anyPart, output: boundedOutput } as typeof part
    })
    if (!partsChanged) return msg
    return { ...msg, parts }
  })
  return boundMessagePayload(anyChanged ? next : messages)
}
