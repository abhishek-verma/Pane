import type { UIMessage, UIMessageChunk } from 'ai'
import type { ChatActiveTurnInfo } from '../conversations/chat-turn-api'

export const CHAT_REPOSITORY_PORT = 'pane-chat-repository-v1'
export interface PreparedChatRequest {
  path: string
  body: Record<string, unknown>
}
export interface ChatSnapshot {
  conversationId: string
  revision: number
  messages: UIMessage[]
  hasMore: boolean
  loaded: boolean
  active: ChatActiveTurnInfo | null
  activityKnown: boolean
  busy: boolean
  error?: string
  vmStatus?: { status: 'booting' | 'error'; progress?: string } | null
}
export type RunEvent =
  | { type: 'chunk'; chunk: UIMessageChunk }
  | { type: 'accepted'; turnId: string; conversationId: string }
export interface RunResult {
  outcome: 'done' | 'paused' | 'pending'
  started?: { turnId: string; conversationId: string }
}
