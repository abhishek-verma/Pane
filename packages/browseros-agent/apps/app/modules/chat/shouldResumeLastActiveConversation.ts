import type { ChatOrigin } from './chat-session.hooks'

export function shouldResumeLastActiveConversation(input: {
  origin: ChatOrigin | undefined
  conversationIdParam: string | null
  qParam: string | null
  storedConversationId: string | null
  /**
   * Per-window scope has no per-tab identity — pass true to skip the tab
   * match below. Per-tab callers resolving their OWN tab-scoped storage
   * (where a match is inherent by construction) may omit `currentTabId`
   * entirely to skip the check the same way.
   */
  perWindow?: boolean
  currentTabId?: number | null
  storedTabId?: number | null
}): boolean {
  if (input.origin === 'newtab') return false
  if (input.conversationIdParam) return false
  if (input.qParam) return false
  if (input.storedConversationId == null) return false
  if (input.perWindow) return true
  if (input.currentTabId === undefined) return true
  return input.storedTabId != null && input.storedTabId === input.currentTabId
}
