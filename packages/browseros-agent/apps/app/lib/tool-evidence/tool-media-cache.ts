/**
 * Client caches for lazily loaded tool media / spilled outputs.
 * Cleared when messages leave the infinite-scroll resident window so heap
 * falls with the scroll window (plan Phase 1b / 2 media lifecycle).
 */

const toolOutputTextCache = new Map<string, string>()
const toolImageBlobUrlCache = new Map<string, string>()

export function getCachedToolOutputText(
  toolCallId: string,
): string | undefined {
  return toolOutputTextCache.get(toolCallId)
}

export function setCachedToolOutputText(
  toolCallId: string,
  text: string,
): void {
  toolOutputTextCache.set(toolCallId, text)
}

export function clearCachedToolOutputText(toolCallId: string): void {
  toolOutputTextCache.delete(toolCallId)
}

export function getCachedToolImageBlobUrl(
  toolCallId: string,
): string | undefined {
  return toolImageBlobUrlCache.get(toolCallId)
}

export function setCachedToolImageBlobUrl(
  toolCallId: string,
  blobUrl: string,
): void {
  const prev = toolImageBlobUrlCache.get(toolCallId)
  if (prev && prev !== blobUrl) {
    URL.revokeObjectURL(prev)
  }
  toolImageBlobUrlCache.set(toolCallId, blobUrl)
}

export function clearCachedToolImageBlobUrl(toolCallId: string): void {
  const prev = toolImageBlobUrlCache.get(toolCallId)
  if (prev) {
    URL.revokeObjectURL(prev)
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

/** Test helper */
export function _toolOutputCacheSizeForTests(): number {
  return toolOutputTextCache.size
}

export function _toolImageBlobCacheSizeForTests(): number {
  return toolImageBlobUrlCache.size
}

export function _clearToolOutputCacheForTests(): void {
  toolOutputTextCache.clear()
  for (const url of toolImageBlobUrlCache.values()) {
    URL.revokeObjectURL(url)
  }
  toolImageBlobUrlCache.clear()
}
