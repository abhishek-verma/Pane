/**
 * Client caches for lazily loaded tool media / spilled outputs.
 * LRU + byte caps keep privileged LO-space bounded; also cleared when messages
 * leave the infinite-scroll resident window.
 */

import { UI_TOOL_MEDIA_LIMITS } from '@browseros/shared/constants/limits'

type ImageEntry = { url: string; bytes: number }

const toolOutputTextCache = new Map<string, string>()
const toolImageBlobUrlCache = new Map<string, ImageEntry>()

let lastImageEvictionAt = 0
let imageEvictionCount = 0

function touchMapKey<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key)
  map.set(key, value)
}

function totalImageBytes(): number {
  let sum = 0
  for (const e of toolImageBlobUrlCache.values()) sum += e.bytes
  return sum
}

function totalOutputTextChars(): number {
  let sum = 0
  for (const t of toolOutputTextCache.values()) sum += t.length
  return sum
}

function evictOldestImage(): void {
  const oldest = toolImageBlobUrlCache.keys().next().value
  if (typeof oldest !== 'string') return
  const prev = toolImageBlobUrlCache.get(oldest)
  if (prev) URL.revokeObjectURL(prev.url)
  toolImageBlobUrlCache.delete(oldest)
  lastImageEvictionAt = Date.now()
  imageEvictionCount += 1
}

function enforceImageLimits(): void {
  while (
    toolImageBlobUrlCache.size > UI_TOOL_MEDIA_LIMITS.MAX_IMAGE_BLOB_ENTRIES ||
    totalImageBytes() > UI_TOOL_MEDIA_LIMITS.MAX_IMAGE_BLOB_BYTES
  ) {
    if (toolImageBlobUrlCache.size === 0) break
    evictOldestImage()
  }
}

function evictOldestOutputText(): void {
  const oldest = toolOutputTextCache.keys().next().value
  if (typeof oldest !== 'string') return
  toolOutputTextCache.delete(oldest)
}

function enforceOutputTextLimits(): void {
  while (
    toolOutputTextCache.size > UI_TOOL_MEDIA_LIMITS.MAX_OUTPUT_TEXT_ENTRIES ||
    totalOutputTextChars() > UI_TOOL_MEDIA_LIMITS.MAX_OUTPUT_TEXT_CHARS
  ) {
    if (toolOutputTextCache.size === 0) break
    evictOldestOutputText()
  }
}

export function getCachedToolOutputText(
  toolCallId: string,
): string | undefined {
  const text = toolOutputTextCache.get(toolCallId)
  if (text === undefined) return undefined
  touchMapKey(toolOutputTextCache, toolCallId, text)
  return text
}

export function setCachedToolOutputText(
  toolCallId: string,
  text: string,
): void {
  touchMapKey(toolOutputTextCache, toolCallId, text)
  enforceOutputTextLimits()
}

export function clearCachedToolOutputText(toolCallId: string): void {
  toolOutputTextCache.delete(toolCallId)
}

export function getCachedToolImageBlobUrl(
  toolCallId: string,
): string | undefined {
  const entry = toolImageBlobUrlCache.get(toolCallId)
  if (!entry) return undefined
  touchMapKey(toolImageBlobUrlCache, toolCallId, entry)
  return entry.url
}

export function setCachedToolImageBlobUrl(
  toolCallId: string,
  blobUrl: string,
  bytes = 0,
): void {
  const prev = toolImageBlobUrlCache.get(toolCallId)
  if (prev && prev.url !== blobUrl) {
    URL.revokeObjectURL(prev.url)
  }
  touchMapKey(toolImageBlobUrlCache, toolCallId, {
    url: blobUrl,
    bytes: Math.max(0, bytes),
  })
  enforceImageLimits()
}

export function clearCachedToolImageBlobUrl(toolCallId: string): void {
  const prev = toolImageBlobUrlCache.get(toolCallId)
  if (prev) {
    URL.revokeObjectURL(prev.url)
    toolImageBlobUrlCache.delete(toolCallId)
  }
}

function releaseToolCallMedia(toolCallId: string): void {
  toolOutputTextCache.delete(toolCallId)
  clearCachedToolImageBlobUrl(toolCallId)
}

/** Drop cached spilled outputs + image blob URLs for tools in these messages. */
export function releaseMediaForMessages(
  messages: Array<{ parts?: unknown[] }>,
): void {
  for (const msg of messages) {
    for (const part of msg.parts ?? []) {
      if (!part || typeof part !== 'object') continue
      const p = part as { type?: string; toolCallId?: string }
      if (typeof p.type !== 'string' || !p.type.startsWith('tool-')) continue
      if (typeof p.toolCallId === 'string') {
        releaseToolCallMedia(p.toolCallId)
      }
    }
  }
}

/** Debug / soak counters for LO containment. */
export function getToolMediaCacheStats(): {
  imageEntries: number
  imageBytes: number
  outputTextEntries: number
  outputTextChars: number
  imageEvictionCount: number
  lastImageEvictionAt: number
} {
  return {
    imageEntries: toolImageBlobUrlCache.size,
    imageBytes: totalImageBytes(),
    outputTextEntries: toolOutputTextCache.size,
    outputTextChars: totalOutputTextChars(),
    imageEvictionCount,
    lastImageEvictionAt,
  }
}

if (typeof globalThis !== 'undefined') {
  ;(
    globalThis as typeof globalThis & {
      __paneLoDebug?: { getToolMediaCacheStats: typeof getToolMediaCacheStats }
    }
  ).__paneLoDebug = { getToolMediaCacheStats }
}

/** Test helper */
export function _toolOutputCacheSizeForTests(): number {
  return toolOutputTextCache.size
}

export function _toolImageBlobCacheSizeForTests(): number {
  return toolImageBlobUrlCache.size
}

export function _clearToolOutputCacheForTests(): void {
  toolOutputTextCache.clear()
  for (const entry of toolImageBlobUrlCache.values()) {
    URL.revokeObjectURL(entry.url)
  }
  toolImageBlobUrlCache.clear()
  imageEvictionCount = 0
  lastImageEvictionAt = 0
}
