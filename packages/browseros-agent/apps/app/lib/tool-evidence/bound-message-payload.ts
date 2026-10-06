import type { UIMessage } from 'ai'

const WINDOW_BUDGET = 1_000_000
const MAX_PARTS = 128
const OMITTED =
  '\n[Details omitted from this preview because they are too large. The full message remains saved.]'

// Conservative JSON-size bound (including escaped strings), with early exit.
// Never stringify or copy the oversized input just to decide whether it fits.
function fits(value: unknown, budget: number): boolean {
  let remaining = budget
  const visit = (item: unknown, depth: number): boolean => {
    if (depth > 24 || remaining < 0) return false
    if (typeof item === 'string') remaining -= item.length * 6 + 2
    else if (item && typeof item === 'object') {
      remaining -= 2
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue
        remaining -= key.length * 6 + 4
        if (!visit((item as Record<string, unknown>)[key], depth + 1))
          return false
      }
    } else remaining -= 24
    return remaining >= 0
  }
  return visit(value, 0)
}

function withoutAttachmentData(message: UIMessage): UIMessage {
  if (message.role !== 'user') return message
  return {
    ...message,
    parts: message.parts.map((part) =>
      part.type === 'file' ? { ...part, url: '[attachment]' } : part,
    ),
  }
}

/** Last-resort UI projection. Never rewrite tool arguments into executable
 * truncated arguments: oversized tool parts become an explanatory text part.
 * The authoritative server message and conversation identity stay untouched.
 * Validated user attachments have their own upload limits and remain usable.
 */
export function boundMessagePayload(messages: UIMessage[]): UIMessage[] {
  const messageBudget = Math.floor(WINDOW_BUDGET / Math.max(1, messages.length))
  let changed = false
  const next = messages.map((message) => {
    if (fits(withoutAttachmentData(message), messageBudget)) return message
    changed = true
    const partLimit = Math.max(
      1,
      Math.min(MAX_PARTS, Math.floor((messageBudget - 4096) / 1024)),
    )
    // Preserve the visible reply even when hundreds of tool parts precede it.
    const indices = new Set<number>()
    for (let i = 0; i < message.parts.length && indices.size < partLimit; i++) {
      if (message.parts[i].type === 'text') indices.add(i)
    }
    for (let i = 0; i < message.parts.length && indices.size < partLimit; i++)
      indices.add(i)
    const retained = [...indices]
      .sort((a, b) => a - b)
      .map((index) => message.parts[index])
    const partBudget = Math.max(
      512,
      Math.floor((messageBudget - 4096) / Math.max(1, retained.length)),
    )
    const parts: UIMessage['parts'] = retained.map((part) => {
      const measured =
        message.role === 'user' && part.type === 'file'
          ? { ...part, url: '[attachment]' }
          : part
      if (fits(measured, partBudget)) return part
      const text =
        part.type === 'text' || part.type === 'reasoning'
          ? part.text
          : 'Tool or attachment details are too large to display. Any pending tool approval must be retried with a smaller input.'
      const maxChars = Math.max(0, Math.floor((partBudget - 256) / 6))
      const suffix = OMITTED.slice(0, maxChars)
      return {
        type: 'text',
        text: text.slice(0, maxChars - suffix.length) + suffix,
      }
    })
    if (message.parts.length > partLimit)
      parts.push({ type: 'text', text: OMITTED.trim() })
    return {
      id: message.id,
      role: message.role,
      parts,
      ...(message.metadata !== undefined && fits(message.metadata, 1024)
        ? { metadata: message.metadata }
        : {}),
    }
  })
  return changed ? next : messages
}
