/**
 * Client helpers for server-backed sidepanel chat history (M1.5).
 * Server SQLite is the transcript source of truth; chrome.storage only
 * holds prefs / scheduled-job specs / execution-history UI state.
 */

import { storage } from '@wxt-dev/storage'
import type { UIMessage } from 'ai'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { withRequestDeadline } from '@/lib/browseros/request-deadline'

export interface ChatHistoryListItem {
  id: string
  lastMessagedAt: number
  previewText: string
  /** True when this conversation was created by a scheduled/background run. */
  isBackground?: boolean
  backgroundSource?: string | null
}

async function resolveBaseUrl(baseUrl?: string): Promise<string> {
  return baseUrl ?? (await getAgentServerUrl())
}

export async function fetchChatHistoryList(
  baseUrl?: string,
): Promise<ChatHistoryListItem[]> {
  const url = await resolveBaseUrl(baseUrl)
  const response = await agentFetch(`${url}/chat/history`)
  if (!response.ok) {
    throw new Error(`Failed to fetch chat history (${response.status})`)
  }
  const history = (await response.json()) as ChatHistoryListItem[]
  // Older extension schedules kept their run ownership only in local storage.
  const legacyRuns = await storage.getItem<Array<{ conversationId?: string }>>(
    'local:scheduledJobRuns',
  )
  const scheduledIds = new Set(
    (legacyRuns ?? []).map((run) => run.conversationId),
  )
  const missing = history.filter(
    (chat) => !chat.isBackground && scheduledIds.has(chat.id),
  )
  for (let i = 0; i < missing.length; i += 100) {
    await agentFetch(`${url}/chat/history/scheduled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationIds: missing.slice(i, i + 100).map((chat) => chat.id),
      }),
    }).catch(() => undefined)
  }
  return history.map((chat) =>
    scheduledIds.has(chat.id) && !chat.isBackground
      ? { ...chat, isBackground: true, backgroundSource: 'schedule' }
      : chat,
  )
}

export interface ChatMessagePage {
  messages: UIMessage[]
  hasMore: boolean
}

/** Newest page when `beforeId` omitted; older page when scrolling up. */
export async function fetchChatMessagePage(
  conversationId: string,
  options?: {
    beforeId?: string
    limit?: number
    baseUrl?: string
    signal?: AbortSignal
    /** A locally created draft may not have a server transcript yet. */
    allowMissing?: boolean
  },
): Promise<ChatMessagePage> {
  return withRequestDeadline(
    async (signal) => {
      const url = await resolveBaseUrl(options?.baseUrl)
      const params = new URLSearchParams()
      if (options?.beforeId) params.set('beforeId', options.beforeId)
      if (options?.limit != null) params.set('limit', String(options.limit))
      const qs = params.toString()
      const response = await agentFetch(
        `${url}/chat/${encodeURIComponent(conversationId)}/messages${qs ? `?${qs}` : ''}`,
        { signal },
      )
      if (response.status === 404 && options?.allowMissing) {
        return { messages: [], hasMore: false }
      }
      if (!response.ok) {
        throw new Error(
          `Failed to fetch messages for ${conversationId} (${response.status})`,
        )
      }
      return (await response.json()) as ChatMessagePage
    },
    { signal: options?.signal },
  )
}

export async function deleteChatConversation(
  conversationId: string,
  baseUrl?: string,
): Promise<void> {
  const url = await resolveBaseUrl(baseUrl)
  const response = await agentFetch(
    `${url}/chat/${encodeURIComponent(conversationId)}`,
    { method: 'DELETE' },
  )
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Failed to delete conversation ${conversationId} (${response.status})`,
    )
  }
}

export async function importChatConversations(
  conversations: Array<{
    id: string
    messages: UIMessage[]
    lastMessagedAt?: number
  }>,
  baseUrl?: string,
): Promise<{ imported: number; skipped: number }> {
  const url = await resolveBaseUrl(baseUrl)
  const response = await agentFetch(`${url}/chat/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversations }),
  })
  if (!response.ok) {
    throw new Error(`Failed to import conversations (${response.status})`)
  }
  return (await response.json()) as { imported: number; skipped: number }
}
