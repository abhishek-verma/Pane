import type { ToolMedia } from './types'

export interface ExtractedToolOutput {
  text: string
  images: ToolMedia[]
  structured: Record<string, unknown> | null
  isError: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function pushImage(images: ToolMedia[], part: Record<string, unknown>) {
  const data = typeof part.data === 'string' ? part.data : null
  const mimeType =
    typeof part.mimeType === 'string'
      ? part.mimeType
      : typeof part.mediaType === 'string'
        ? part.mediaType
        : null
  if (data && mimeType) images.push({ data, mimeType })
}

function extractFromParts(
  parts: unknown[],
): Omit<ExtractedToolOutput, 'structured' | 'isError'> {
  const texts: string[] = []
  const images: ToolMedia[] = []
  for (const part of parts) {
    if (typeof part === 'string') {
      texts.push(part)
      continue
    }
    const rec = asRecord(part)
    if (!rec) continue
    if (rec.type === 'text' && typeof rec.text === 'string')
      texts.push(rec.text)
    else if (typeof rec.text === 'string' && !rec.type) texts.push(rec.text)
    if (rec.type === 'image' || rec.type === 'media') pushImage(images, rec)
  }
  return { text: texts.filter(Boolean).join('\n'), images }
}

export function extractToolOutput(output: unknown): ExtractedToolOutput {
  if (typeof output === 'string') {
    return { text: output, images: [], structured: null, isError: false }
  }
  if (Array.isArray(output)) {
    return { ...extractFromParts(output), structured: null, isError: false }
  }
  const rec = asRecord(output)
  if (!rec) {
    return { text: '', images: [], structured: null, isError: false }
  }

  const isError = rec.isError === true
  const structured =
    asRecord(rec.structuredContent) ??
    (asRecord(rec.structured) && !('content' in rec)
      ? asRecord(rec.structured)
      : null)

  if (Array.isArray(rec.content)) {
    return { ...extractFromParts(rec.content), structured, isError }
  }
  if (typeof rec.text === 'string') {
    return { text: rec.text, images: [], structured, isError }
  }
  return { text: '', images: [], structured, isError }
}
