/**
 * Store-before-stream helpers for tool screenshot blobs.
 *
 * UIMessage / SSE paths keep only `{ stripped: true }` image placeholders.
 * Model path rehydrates bytes from ToolImageStore via toModelOutput.
 */

import type { ContentBlock } from '@browseros/browser-mcp/tools/framework'
import type { ToolImageStore } from './session-store'

export type StripAndStoreOptions = {
  sessionId: string
  toolCallId: string
  imageStore: ToolImageStore
}

/** True when a content block is an image carrying inline base64 `data`. */
export function isInlineImageBlock(item: unknown): item is {
  type: 'image'
  data: string
  mimeType?: string
  mediaType?: string
} {
  if (typeof item !== 'object' || item === null) return false
  const rec = item as Record<string, unknown>
  return (
    rec.type === 'image' &&
    typeof rec.data === 'string' &&
    rec.data.length > 0 &&
    rec.stripped !== true
  )
}

/** True when a content block is a stripped image placeholder. */
export function isStrippedImageBlock(item: unknown): item is {
  type: 'image'
  stripped: true
  mimeType?: string
  mediaType?: string
} {
  if (typeof item !== 'object' || item === null) return false
  const rec = item as Record<string, unknown>
  return rec.type === 'image' && rec.stripped === true
}

/**
 * Persist inline image bytes to ToolImageStore and return content with
 * `{ stripped: true }` placeholders (no `data` field).
 */
export function stripAndStoreImages(
  content: ContentBlock[],
  options: StripAndStoreOptions,
): ContentBlock[] {
  let changed = false
  const next = content.map((item) => {
    if (!isInlineImageBlock(item)) return item
    const mimeType =
      typeof item.mimeType === 'string'
        ? item.mimeType
        : typeof (item as { mediaType?: string }).mediaType === 'string'
          ? (item as { mediaType: string }).mediaType
          : 'image/jpeg'
    options.imageStore.store(
      options.sessionId,
      options.toolCallId,
      item.data,
      mimeType,
    )
    changed = true
    const stripped: ContentBlock = {
      type: 'image',
      mimeType,
      stripped: true,
    }
    return stripped
  })
  return changed ? next : content
}

/**
 * Reload stripped image bytes from ToolImageStore for the model path.
 * On store miss, replaces the image with a text `[Image]` stub.
 */
export function rehydrateImagesForModel(
  content: ContentBlock[],
  options: { toolCallId: string; imageStore: ToolImageStore },
): ContentBlock[] {
  return content.flatMap((item) => {
    if (!isStrippedImageBlock(item) && !isInlineImageBlock(item)) {
      return [item]
    }
    if (isInlineImageBlock(item)) {
      return [item]
    }
    const stored = options.imageStore.get(options.toolCallId)
    if (!stored) {
      return [{ type: 'text' as const, text: '[Image]' }]
    }
    return [
      {
        type: 'image' as const,
        data: stored.data.toString('base64'),
        mimeType: stored.mimeType,
      },
    ]
  })
}
