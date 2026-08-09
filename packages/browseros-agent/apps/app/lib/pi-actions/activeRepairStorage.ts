import { type StorageItemKey, storage } from '@wxt-dev/storage'

/**
 * Tracks the in-flight conversationId for a PI page's "Fix/Refresh with
 * agent" action, keyed by pageId. Session-scoped: a stale entry from a
 * finished turn is harmless because callers always probe liveness
 * (fetchActiveChatTurn) before trusting it — this is a hint, not a lock.
 */
function repairKey(pageId: string): StorageItemKey {
  return `session:browseros.pi.active_repair.${pageId}`
}

export async function getActiveRepairConversation(
  pageId: string,
): Promise<string | null> {
  return storage.getItem<string>(repairKey(pageId))
}

export async function setActiveRepairConversation(
  pageId: string,
  conversationId: string,
): Promise<void> {
  await storage.setItem(repairKey(pageId), conversationId)
}

export async function clearActiveRepairConversation(
  pageId: string,
): Promise<void> {
  await storage.setItem(repairKey(pageId), null)
}
