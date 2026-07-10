/**
 * Client helpers for server-backed sidepanel chat history (M1.5).
 * Server SQLite is the transcript source of truth; chrome.storage only
 * holds prefs / scheduled-job specs / execution-history UI state.
 */

import type { UIMessage } from 'ai'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

export interface ChatHistoryListItem {
  id: string
  lastMessagedAt: number
  previewText: string
}

export interface ChatConversationDetail {
  id: string
  messages: UIMessage[]
}

async function resolveBaseUrl(baseUrl?: string): Promise<string> {
  return baseUrl ?? (await getAgentServerUrl())
}

export async function fetchChatHistoryList(
  baseUrl?: string,
): Promise<ChatHistoryListItem[]> {
  const url = await resolveBaseUrl(baseUrl)
  const response = await fetch(`${url}/chat/history`)
  if (!response.ok) {
    throw new Error(`Failed to fetch chat history (${response.status})`)
  }
  return (await response.json()) as ChatHistoryListItem[]
}

export async function fetchChatConversation(
  conversationId: string,
  baseUrl?: string,
): Promise<ChatConversationDetail> {
  const url = await resolveBaseUrl(baseUrl)
  const response = await fetch(
    `${url}/chat/${encodeURIComponent(conversationId)}`,
  )
  if (!response.ok) {
    throw new Error(
      `Failed to fetch conversation ${conversationId} (${response.status})`,
    )
  }
  return (await response.json()) as ChatConversationDetail
}

export async function deleteChatConversation(
  conversationId: string,
  baseUrl?: string,
): Promise<void> {
  const url = await resolveBaseUrl(baseUrl)
  const response = await fetch(
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
  const response = await fetch(`${url}/chat/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversations }),
  })
  if (!response.ok) {
    throw new Error(`Failed to import conversations (${response.status})`)
  }
  return (await response.json()) as { imported: number; skipped: number }
}
