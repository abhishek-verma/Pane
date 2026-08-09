import type { ChatOrigin } from './chat-session.hooks'

export function shouldResumeLastActiveConversation(input: {
  origin: ChatOrigin | undefined
  conversationIdParam: string | null
  qParam: string | null
  storedConversationId: string | null
}): boolean {
  if (input.origin === 'newtab') return false
  if (input.conversationIdParam) return false
  if (input.qParam) return false
  return input.storedConversationId != null
}
