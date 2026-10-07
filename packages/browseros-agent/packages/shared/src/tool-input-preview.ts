// Bound encoded JSON size without allocating a serialized copy. Ordinary ASCII
// costs one byte, not six; only control characters/lone surrogates need six.
// Stop scanning as soon as the budget is exhausted, including deeply nested data.
export function measuredSize(value: unknown, budget: number): number {
  let remaining = budget
  const string = (text: string): boolean => {
    remaining -= 2
    if (text.length > remaining) return false
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code < 32) remaining -= 6
      else if (code === 34 || code === 92) remaining -= 2
      else if (code < 128) remaining--
      else if (code < 2048) remaining -= 2
      else if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        text.charCodeAt(i + 1) >= 0xdc00 &&
        text.charCodeAt(i + 1) <= 0xdfff
      ) {
        remaining -= 4
        i++
      } else remaining -= code >= 0xd800 && code <= 0xdfff ? 6 : 3
      if (remaining < 0) return false
    }
    return remaining >= 0
  }
  const visit = (item: unknown, depth: number): boolean => {
    if (depth > 24 || remaining < 0) return false
    if (typeof item === 'string') return string(item)
    if (item && typeof item === 'object') {
      remaining -= 2
      const array = Array.isArray(item)
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue
        remaining -= 2
        if (!array && !string(key)) return false
        if (!visit((item as Record<string, unknown>)[key], depth + 1))
          return false
      }
    } else remaining -= 24
    return remaining >= 0
  }
  return visit(value, 0) ? budget - remaining : Number.POSITIVE_INFINITY
}

export function fitsPreviewBudget(value: unknown, budget: number): boolean {
  return measuredSize(value, budget) <= budget
}

/** A display preview only. Never use this value as executable tool arguments. */
export function previewJson(value: unknown): unknown {
  let remaining = 4000
  const visit = (item: unknown, depth: number): unknown => {
    if (remaining <= 0 || depth > 5) return '…'
    if (typeof item === 'string') {
      const limit = Math.min(512, remaining)
      remaining -= Math.min(item.length, limit)
      return item.length > limit ? `${item.slice(0, limit)}…` : item
    }
    if (!item || typeof item !== 'object') {
      remaining -= 24
      return item
    }
    const result: Record<string, unknown> = Object.create(null)
    const array: unknown[] = []
    for (const key in item) {
      if (!Object.hasOwn(item, key)) continue
      if (remaining <= 0) break
      remaining -= key.length + 8
      const next = visit((item as Record<string, unknown>)[key], depth + 1)
      if (Array.isArray(item)) array.push(next)
      else result[key.slice(0, 128)] = next
    }
    return Array.isArray(item) ? array : result
  }
  return visit(value, 0)
}

/** Mark every input preview explicitly. Approval UIs must load the authoritative
 * input before enabling approval or promotion; this value is display-only.
 */
export function previewToolInput<T extends { type: string }>(part: T): T {
  if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-'))
    return part
  const tool = part as T & Record<string, unknown>
  if (tool.inputPreviewed || fitsPreviewBudget(tool.input, 16_000)) return part
  return { ...part, input: previewJson(tool.input), inputPreviewed: true }
}
