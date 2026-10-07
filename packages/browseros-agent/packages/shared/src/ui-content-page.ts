import { fitsPreviewBudget, previewJson } from './tool-input-preview'

export type ContentCursor = { part: number; offset: number }
export type UiContentPage = {
  part: {
    type: string
    text?: string
    toolCallId?: string
    toolName?: string
    input?: unknown
    output?: unknown
    state?: string
  }
  index: number
  totalParts: number
  previous: ContentCursor | null
  next: ContentCursor | null
}
const PAGE_CHARS = 8000

/** A single bounded page, never a growing accumulated copy of the message. */
export function uiContentPage(
  parts: { type: string }[],
  cursor?: ContentCursor,
): UiContentPage | null {
  if (!parts.length) return null
  let index =
    cursor?.part ?? parts.findLastIndex((part) => part.type === 'text')
  if (index < 0) index = 0
  if (index >= parts.length) return null
  const source = parts[index] as Record<string, unknown> & { type: string }
  const offset = cursor?.offset ?? 0
  let next: ContentCursor | null =
    index + 1 < parts.length ? { part: index + 1, offset: 0 } : null
  const previous =
    offset > 0
      ? { part: index, offset: Math.max(0, offset - PAGE_CHARS) }
      : index > 0
        ? { part: index - 1, offset: 0 }
        : null
  let part: UiContentPage['part']
  if (source.type === 'text' || source.type === 'reasoning') {
    const text = typeof source.text === 'string' ? source.text : ''
    if (offset > text.length) return null
    const end = Math.min(text.length, offset + PAGE_CHARS)
    part = { type: source.type, text: text.slice(offset, end) }
    if (end < text.length) next = { part: index, offset: end }
  } else {
    part = {
      type: source.type.slice(0, 128),
      ...(typeof source.toolCallId === 'string' &&
      source.toolCallId.length <= 256
        ? { toolCallId: source.toolCallId }
        : {}),
      ...(typeof source.toolName === 'string'
        ? { toolName: source.toolName.slice(0, 256) }
        : {}),
      ...(typeof source.state === 'string'
        ? { state: source.state.slice(0, 64) }
        : {}),
      input: fitsPreviewBudget(source.input, 4000)
        ? source.input
        : previewJson(source.input),
      output: fitsPreviewBudget(source.output, 4000)
        ? source.output
        : previewJson(source.output),
    }
  }
  return { part, index, totalParts: parts.length, previous, next }
}
