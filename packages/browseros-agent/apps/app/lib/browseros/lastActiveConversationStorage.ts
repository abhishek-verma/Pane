import { storage } from '@wxt-dev/storage'

export type LastActiveConversation = {
  conversationId: string
  /**
   * The tab whose panel started this turn, or null when started from a
   * per-window panel (tab identity does not apply there). Cold-mount resume
   * only trusts this record when tabId matches the resuming tab — this key
   * is a single value shared by every window/panel, so without the tab
   * check a still-running turn in one tab would hijack a fresh panel mount
   * in a completely different tab.
   */
  tabId: number | null
}

/**
 * The conversationId a chat turn was most recently started on, across the
 * whole extension (not per-window/per-tab on its own — see `tabId` above).
 * Read once on side-panel cold mount to probe whether that turn is still
 * running server-side before defaulting to a blank chat — see
 * chat-session.hooks.ts's resume-on-mount effect. Local storage (not
 * session) so it survives a full extension/browser restart, matching how
 * server-side turns already survive restarts.
 */
const KEY = 'local:browseros.chat.last_active_conversation_id' as const

export async function getLastActiveConversation(): Promise<LastActiveConversation | null> {
  return storage.getItem<LastActiveConversation>(KEY)
}

export async function setLastActiveConversation(
  conversationId: string,
  tabId: number | null,
): Promise<void> {
  await storage.setItem(KEY, { conversationId, tabId })
}

export async function clearLastActiveConversation(): Promise<void> {
  await storage.setItem(KEY, null)
}
