import { storage } from '@wxt-dev/storage'
import type { UIMessage } from 'ai'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { conversationStorage } from './conversationStorage'
import { importChatConversations } from './server-chat-history'

/**
 * One-time flag: local chrome.storage transcripts have been imported into
 * server SQLite (or there was nothing to import).
 */
export const conversationsMigratedStorage = storage.defineItem<boolean>(
  'local:conversationsMigratedToServer',
  { fallback: false },
)

/**
 * Migrates legacy `local:conversations` into server SQLite, then clears
 * the chrome.storage transcript cache. Idempotent: skips session ids that
 * already exist on the server.
 */
export async function migrateConversationsToServer(options?: {
  baseUrl?: string
}): Promise<{ imported: number; skipped: number; alreadyDone: boolean }> {
  const alreadyDone = await conversationsMigratedStorage.getValue()
  if (alreadyDone) {
    return { imported: 0, skipped: 0, alreadyDone: true }
  }

  const local = (await conversationStorage.getValue()) ?? []
  if (local.length === 0) {
    await conversationsMigratedStorage.setValue(true)
    return { imported: 0, skipped: 0, alreadyDone: false }
  }

  const baseUrl = options?.baseUrl ?? (await getAgentServerUrl())
  const result = await importChatConversations(
    local.map((conversation) => ({
      id: conversation.id,
      messages: conversation.messages as UIMessage[],
      lastMessagedAt: conversation.lastMessagedAt,
    })),
    baseUrl,
  )

  await conversationStorage.setValue([])
  await conversationsMigratedStorage.setValue(true)
  return { ...result, alreadyDone: false }
}
