import { storage } from '@wxt-dev/storage'
import type {
  ExecutionHistoryByConversation,
  ExecutionTaskRecord,
} from './types'

const executionHistoryStorage =
  storage.defineItem<ExecutionHistoryByConversation>(
    'local:executionHistoryByConversation',
    {
      fallback: {},
      version: 1,
    },
  )

const taskPrefix = (conversationId: string) =>
  `executionHistoryTaskV2:${encodeURIComponent(conversationId)}:`

/** Write only the changed task. The legacy all-conversations record remains
 * intact for existing history; streaming must never read/serialize/broadcast
 * that growing archive. Independent tasks also no longer overwrite each other.
 */
export async function upsertConversationExecutionTask(
  task: ExecutionTaskRecord,
): Promise<void> {
  await chrome.storage.local.set({
    [`${taskPrefix(task.conversationId)}${encodeURIComponent(task.id)}`]: task,
  })
}

export async function removeConversationExecutionHistory(
  conversationId: string,
): Promise<void> {
  const prefix = taskPrefix(conversationId)
  const keys = (await chrome.storage.local.getKeys()).filter((key) =>
    key.startsWith(prefix),
  )
  if (keys.length) await chrome.storage.local.remove(keys)
  const current = (await executionHistoryStorage.getValue()) ?? {}
  if (!(conversationId in current)) return

  const { [conversationId]: _removed, ...rest } = current
  await executionHistoryStorage.setValue(rest)
}
