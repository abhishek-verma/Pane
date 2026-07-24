/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Sidepanel chat turn lifecycle API (active / stream / cancel).
 */

import type { UIMessage } from 'ai'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

export interface ChatActiveTurnInfo {
  turnId: string
  conversationId: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  lastSeq: number
  startedAt: number
  endedAt?: number
  prompt: string | null
  truncated: boolean
}

export async function fetchActiveChatTurn(
  conversationId: string,
  baseUrl?: string,
): Promise<ChatActiveTurnInfo | null> {
  const url = baseUrl ?? (await getAgentServerUrl())
  const response = await agentFetch(
    `${url}/chat/${encodeURIComponent(conversationId)}/active`,
  )
  if (!response.ok) return null
  const body = (await response.json()) as {
    active: ChatActiveTurnInfo | null
  }
  return body.active
}

export async function cancelChatTurn(
  conversationId: string,
  options: { reason?: string; baseUrl?: string } = {},
): Promise<{ cancelled: boolean }> {
  const url = options.baseUrl ?? (await getAgentServerUrl())
  const response = await agentFetch(
    `${url}/chat/${encodeURIComponent(conversationId)}/cancel`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(options.reason ? { reason: options.reason } : {}),
      }),
    },
  )
  if (!response.ok) return { cancelled: false }
  return (await response.json()) as { cancelled: boolean }
}

export type ChatTurnStreamEvent =
  | { type: 'snapshot'; messages: UIMessage[] }
  | { type: 'done'; status: 'done' | 'error' | 'cancelled' }

/**
 * Attach to a running turn's snapshot SSE. Resolves when the stream ends.
 * Calls onEvent for each frame; onEvent may be sync or async.
 */
export async function attachChatTurnStream(input: {
  conversationId: string
  turnId?: string
  lastSeq?: number
  signal?: AbortSignal
  baseUrl?: string
  onEvent: (event: ChatTurnStreamEvent, seq: number) => void | Promise<void>
}): Promise<void> {
  const urlBase = input.baseUrl ?? (await getAgentServerUrl())
  const url = new URL(
    `${urlBase}/chat/${encodeURIComponent(input.conversationId)}/stream`,
  )
  if (input.turnId) url.searchParams.set('turnId', input.turnId)
  const headers: Record<string, string> = {}
  if (typeof input.lastSeq === 'number') {
    headers['Last-Event-ID'] = String(input.lastSeq)
  }
  const response = await agentFetch(url.toString(), {
    signal: input.signal,
    headers,
  })
  if (!response.ok || !response.body) {
    throw new Error(`Failed to attach chat turn (${response.status})`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let pendingId: number | undefined
  let pendingData: string[] = []

  const flush = async () => {
    if (pendingData.length === 0) return
    const data = pendingData.join('\n')
    pendingData = []
    const seq = pendingId ?? -1
    pendingId = undefined
    if (data === '[DONE]') return
    try {
      const parsed = JSON.parse(data) as ChatTurnStreamEvent
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        await input.onEvent(parsed, seq)
      }
    } catch {
      // ignore malformed frames
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('id:')) {
        const n = Number.parseInt(line.slice(3).trim(), 10)
        if (Number.isFinite(n)) pendingId = n
      } else if (line.startsWith('data:')) {
        pendingData.push(line.slice(5).trimStart())
      } else if (line === '') {
        await flush()
      }
    }
  }
  await flush()
}
