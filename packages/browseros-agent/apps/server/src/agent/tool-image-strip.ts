/**
 * Store-before-stream helpers for tool screenshot blobs.
 *
 * UIMessage / SSE paths keep only `{ stripped: true }` image placeholders when
 * the blob was successfully stored. Model path rehydrates from ToolImageStore.
 * Missing or unstored images are omitted — never replaced with stub text.
 */

import type { ContentBlock } from '@browseros/browser-mcp/tools/framework'
import { logger } from '../lib/logger'
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

function resolveImageMimeType(item: {
  mimeType?: string
  mediaType?: string
}): string {
  if (typeof item.mimeType === 'string') return item.mimeType
  if (typeof item.mediaType === 'string') return item.mediaType
  return 'image/jpeg'
}

/**
 * Persist inline image bytes to ToolImageStore and return content with
 * `{ stripped: true }` placeholders (no `data` field).
 *
 * If persistence fails, the image block is omitted so UI/model never see a
 * placeholder that cannot be loaded.
 */
export function stripAndStoreImages(
  content: ContentBlock[],
  options: StripAndStoreOptions,
): ContentBlock[] {
  let changed = false
  const next: ContentBlock[] = []

  for (const item of content) {
    if (!isInlineImageBlock(item)) {
      next.push(item)
      continue
    }
    const mimeType = resolveImageMimeType(item)
    const stored = options.imageStore.store(
      options.sessionId,
      options.toolCallId,
      item.data,
      mimeType,
    )
    changed = true
    if (!stored) {
      logger.warn('Omitting tool image after store failure', {
        sessionId: options.sessionId,
        toolCallId: options.toolCallId,
      })
      continue
    }
    next.push({
      type: 'image',
      mimeType,
      stripped: true,
    })
  }

  return changed ? next : content
}

/**
 * Reload stripped image bytes from ToolImageStore for the model path.
 * On store miss, omits the image (keeps surrounding tool text).
 */
export function rehydrateImagesForModel(
  content: ContentBlock[],
  options: { toolCallId: string; imageStore: ToolImageStore },
): ContentBlock[] {
  return content.flatMap((item) => {
    if (isInlineImageBlock(item)) {
      return [item]
    }
    if (!isStrippedImageBlock(item)) {
      return [item]
    }
    const stored = options.imageStore.get(options.toolCallId)
    if (!stored) {
      logger.warn('Tool image missing for model rehydrate; omitting', {
        toolCallId: options.toolCallId,
      })
      return []
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
