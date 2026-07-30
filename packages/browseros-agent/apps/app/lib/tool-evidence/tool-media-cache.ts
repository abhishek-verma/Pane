/**
 * Client caches for lazily loaded tool media / spilled outputs.
 * Cleared when messages leave the infinite-scroll resident window so heap
 * falls with the scroll window (plan Phase 1b / 2 media lifecycle).
 */

const toolOutputTextCache = new Map<string, string>()

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

/** Drop cached spilled outputs for tools belonging to these messages. */
export function releaseMediaForMessages(
  messages: Array<{ parts?: unknown[] }>,
): void {
  for (const msg of messages) {
    for (const part of msg.parts ?? []) {
      if (!part || typeof part !== 'object') continue
      const p = part as { type?: string; toolCallId?: string }
      if (typeof p.type !== 'string' || !p.type.startsWith('tool-')) continue
      if (typeof p.toolCallId === 'string') {
        toolOutputTextCache.delete(p.toolCallId)
      }
    }
  }
}

/** Test helper */
export function _toolOutputCacheSizeForTests(): number {
  return toolOutputTextCache.size
}

export function _clearToolOutputCacheForTests(): void {
  toolOutputTextCache.clear()
}
