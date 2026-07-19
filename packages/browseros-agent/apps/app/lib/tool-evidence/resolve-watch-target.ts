import type { UIMessage } from 'ai'
import { classifyToolVisibility } from './classify'

/** Positive integer `input.page` from the newest browser tool part, if any. */
export function resolveWatchPageId(messages: UIMessage[]): number | undefined {
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const message = messages[mi]
    if (message.role !== 'assistant') continue
    const parts = message.parts ?? []
    for (let pi = parts.length - 1; pi >= 0; pi--) {
      const part = parts[pi] as {
        type?: string
        toolName?: string
        input?: Record<string, unknown>
      }
      if (!part.type?.startsWith('tool-') && part.type !== 'dynamic-tool') {
        continue
      }
      const toolName =
        part.toolName ??
        (part.type?.startsWith('tool-') ? part.type.slice('tool-'.length) : '')
      if (!toolName) continue
      const kind = classifyToolVisibility(toolName)
      if (kind !== 'browser-action' && kind !== 'screenshot') continue
      const page = part.input?.page
      if (typeof page === 'number' && Number.isInteger(page) && page > 0) {
        return page
      }
    }
  }
  return undefined
}

export function httpToWsBase(httpBase: string): string {
  if (httpBase.startsWith('https://')) {
    return `wss://${httpBase.slice('https://'.length)}`
  }
  if (httpBase.startsWith('http://')) {
    return `ws://${httpBase.slice('http://'.length)}`
  }
  return httpBase
}

export function buildScreencastWsUrl(
  httpBase: string,
  windowId: number,
  pageId?: number,
): string {
  const wsBase = httpToWsBase(httpBase).replace(/\/$/, '')
  const params = new URLSearchParams({ windowId: String(windowId) })
  if (pageId != null && pageId > 0) {
    params.set('pageId', String(pageId))
  }
  return `${wsBase}/screencast?${params.toString()}`
}
