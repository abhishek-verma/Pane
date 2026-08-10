import { type StorageItemKey, storage } from '@wxt-dev/storage'

/**
 * Stores each tab's active conversation under its own key, so a per-tab
 * (default, non-window-scoped) panel resumes that tab's own conversation
 * when it (re)mounts instead of starting blank or picking up whatever
 * conversation happens to be last-active globally. Per-key (not a shared
 * map) so concurrent tabs can't clobber each other's entry. Session-scoped:
 * tab ids are not stable across restarts.
 */
function tabConversationKey(tabId: number): StorageItemKey {
  return `session:browseros.side_panel.tab_conversation.${tabId}`
}

export async function getTabConversation(
  tabId: number,
): Promise<string | null> {
  return storage.getItem<string>(tabConversationKey(tabId))
}

export async function setTabConversation(
  tabId: number,
  conversationId: string,
): Promise<void> {
  await storage.setItem(tabConversationKey(tabId), conversationId)
}
