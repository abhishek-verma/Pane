import type { UIMessage } from 'ai'
import { bareToolName } from '@/lib/tool-name'
import { classifyToolVisibility } from './classify'

function toolNameFromPart(part: { type?: string; toolName?: string }): string {
  const raw =
    part.toolName ??
    (part.type?.startsWith('tool-') ? part.type.slice('tool-'.length) : '')
  return raw ? bareToolName(raw) : raw
}

function isBrowserWatchTool(toolName: string): boolean {
  const kind = classifyToolVisibility(toolName)
  return kind === 'browser-action' || kind === 'screenshot'
}

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
      const toolName = toolNameFromPart(part)
      if (!toolName || !isBrowserWatchTool(toolName)) continue
      const page = part.input?.page
      if (typeof page === 'number' && Number.isInteger(page) && page > 0) {
        return page
      }
    }
  }
  return undefined
}

/**
 * LiveWatch only while the agent is streaming *and* the newest assistant
 * message already has a browser/screenshot tool (in progress or completed).
 * Avoids opening the screencast WS for pure reasoning / file-only turns.
 */
export function shouldEnableLiveWatch(
  messages: UIMessage[],
  isStreaming: boolean,
): boolean {
  if (!isStreaming) return false
  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const message = messages[mi]
    if (message.role !== 'assistant') continue
    for (const part of message.parts ?? []) {
      const p = part as { type?: string; toolName?: string }
      if (!p.type?.startsWith('tool-') && p.type !== 'dynamic-tool') continue
      const toolName = toolNameFromPart(p)
      if (toolName && isBrowserWatchTool(toolName)) return true
    }
    return false
  }
  return false
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
