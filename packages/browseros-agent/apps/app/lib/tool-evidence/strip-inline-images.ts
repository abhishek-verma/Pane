import type { UIMessage } from 'ai'

/** Inline base64 larger than this is replaced with a stripped placeholder. */
export const INLINE_IMAGE_STRIP_THRESHOLD_BYTES = 100_000

/** Conversations larger than this after strip are quarantined (safe open). */
export const POISON_SESSION_BYTES = 2_000_000

/**
 * Client-side defense: never put multi-MB base64 image `data` into React /
 * useChat state. Replaces large inline images with `{ stripped: true }` and
 * drops legacy `structuredContent.image` duplicates.
 *
 * Returns a new messages array when any image was stripped; otherwise the
 * original reference.
 */
export function stripFatInlineImagesFromMessages(
  messages: UIMessage[],
  thresholdBytes = INLINE_IMAGE_STRIP_THRESHOLD_BYTES,
): UIMessage[] {
  let changed = false

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
      let nextRec = rec
      let outputChanged = false

      if (Array.isArray(rec.content)) {
        let contentChanged = false
        const newContent = (rec.content as unknown[]).map((item) => {
          if (typeof item !== 'object' || item === null) return item
          const img = item as Record<string, unknown>
          if (img.type !== 'image' || img.stripped === true) return item
          const data = img.data
          if (typeof data !== 'string' || data.length <= thresholdBytes) {
            return item
          }
          contentChanged = true
          const { data: _removed, ...rest } = img
          return { ...rest, stripped: true }
        })
        if (contentChanged) {
          nextRec = { ...nextRec, content: newContent }
          outputChanged = true
        }
      }

      const structured = nextRec.structuredContent
      if (
        structured &&
        typeof structured === 'object' &&
        !Array.isArray(structured)
      ) {
        const sc = structured as Record<string, unknown>
        if (typeof sc.image === 'string' && sc.image.length > 0) {
          const { image: _dup, ...rest } = sc
          nextRec = { ...nextRec, structuredContent: rest }
          outputChanged = true
        }
      }

      if (!outputChanged) return part
      partsChanged = true
      return { ...anyPart, output: nextRec } as typeof part
    })

    if (!partsChanged) return msg
    changed = true
    return { ...msg, parts }
  })

  return changed ? next : messages
}

/** Rough serialized size for safe-open gates. */
export function estimateUiMessagesBytes(messages: UIMessage[]): number {
  try {
    return JSON.stringify(messages).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** True when messages are still too large to safely hydrate into useChat. */
export function isPoisonSessionPayload(messages: UIMessage[]): boolean {
  return estimateUiMessagesBytes(messages) > POISON_SESSION_BYTES
}
