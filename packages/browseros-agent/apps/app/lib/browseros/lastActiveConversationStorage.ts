import { storage } from '@wxt-dev/storage'

/**
 * The conversationId a chat turn was most recently started on, across the
 * whole extension (not per-window). Read once on side-panel cold mount to
 * probe whether that turn is still running server-side before defaulting to
 * a blank chat — see chat-session.hooks.ts's resume-on-mount effect. Local
 * storage (not session) so it survives a full extension/browser restart,
 * matching how server-side turns already survive restarts.
 */
const KEY = 'local:browseros.chat.last_active_conversation_id' as const

export async function getLastActiveConversation(): Promise<string | null> {
  return storage.getItem<string>(KEY)
}

export async function setLastActiveConversation(
  conversationId: string,
): Promise<void> {
  await storage.setItem(KEY, conversationId)
}

export async function clearLastActiveConversation(): Promise<void> {
  await storage.setItem(KEY, null)
}
