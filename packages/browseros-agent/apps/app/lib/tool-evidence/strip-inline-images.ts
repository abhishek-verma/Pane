import type { UIMessage } from 'ai'

/**
 * @deprecated Prefer stripping all tool images for UI. Kept for callers that
 * pass an explicit threshold; default strip uses 0 (all inline image data).
 */
export const INLINE_IMAGE_STRIP_THRESHOLD_BYTES = 0

/** Conversations larger than this after strip are quarantined (safe open). */
export const POISON_SESSION_BYTES = 2_000_000

/**
 * Client-side defense: never put tool screenshot `data` into React / useChat.
 * Replaces inline images with `{ stripped: true }` and drops legacy
 * `structuredContent.image` duplicates.
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

/**
 * Approximate serialized size without JSON.stringify of fat image `data`
 * fields (those alone can allocate multi-MB LO strings during the estimate).
 */
export function estimateUiMessagesBytes(messages: UIMessage[]): number {
  let total = 2 // []
  for (let i = 0; i < messages.length; i++) {
    if (i > 0) total += 1
    total += estimateValueBytes(messages[i], 0)
    if (total > POISON_SESSION_BYTES * 2) return total
  }
  return total
}

function estimateValueBytes(value: unknown, depth: number): number {
  if (value == null) return 4
  if (typeof value === 'boolean') return value ? 4 : 5
  if (typeof value === 'number') return String(value).length
  if (typeof value === 'string') return value.length + 2
  if (depth > 30) return 8
  if (Array.isArray(value)) {
    let n = 2
    for (let i = 0; i < value.length; i++) {
      if (i > 0) n += 1
      n += estimateValueBytes(value[i], depth + 1)
    }
    return n
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>
    // Short-circuit known fat image payloads.
    if (rec.type === 'image' && typeof rec.data === 'string') {
      return 64 + rec.data.length
    }
    let n = 2
    let first = true
    for (const key of Object.keys(rec)) {
      if (!first) n += 1
      first = false
      n += key.length + 3
      if (
        key === 'data' &&
        typeof rec.data === 'string' &&
        rec.type === 'image'
      ) {
        n += rec.data.length + 2
        continue
      }
      if (
        key === 'image' &&
        typeof rec.image === 'string' &&
        rec.image.length > 10_000
      ) {
        n += rec.image.length + 2
        continue
      }
      n += estimateValueBytes(rec[key], depth + 1)
    }
    return n
  }
  return 8
}

/** True when messages are still too large to safely hydrate into useChat. */
export function isPoisonSessionPayload(messages: UIMessage[]): boolean {
  return estimateUiMessagesBytes(messages) > POISON_SESSION_BYTES
}
