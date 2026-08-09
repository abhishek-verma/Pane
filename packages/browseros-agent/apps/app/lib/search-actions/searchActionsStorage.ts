import { storage } from '@wxt-dev/storage'
import type { ChatAction } from '@/lib/chat-actions/types'

/**
 * @public
 */
export interface SearchActionStorage {
  /** Unique per dispatch — the dedup key for a possibly-doubled delivery. */
  requestId: string
  query: string
  mode: 'chat' | 'agent'
  action?: ChatAction
  /** Open an existing conversation in the side panel (Open owner agent). */
  conversationId?: string
  /** Seed a fresh (non-reattach) send with this id instead of a random one. */
  newConversationId?: string
}

/**
 * @public
 */
export const searchActionsStorage = storage.defineItem<SearchActionStorage>(
  'local:search-actions',
)
