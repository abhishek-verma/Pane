import type { UIMessage } from 'ai'
import type { QueuedMessage } from '@/modules/chat/composer-store'
import {
  getResponsePreview,
  normalizeExecutionSteps,
} from '../execution-history/normalize'
import { upsertConversationExecutionTask } from '../execution-history/storage'
import type { ExecutionTaskStatus } from '../execution-history/types'

/** The outbox owns execution history too; closing a view cannot prevent its
 * terminal record from being written. Stream transcripts stay in the server. */
export async function recordQueuedExecution(
  id: string,
  item: QueuedMessage,
  messages: UIMessage[],
  status: ExecutionTaskStatus,
) {
  if (item.kind === 'approval') return
  const assistant =
    messages.at(-1)?.role === 'assistant' ? messages.at(-1) : undefined
  const now = new Date().toISOString()
  const steps = normalizeExecutionSteps({
    assistantMessage: assistant,
    previousSteps: [],
    nowIso: now,
  })
  await upsertConversationExecutionTask({
    id: item.id,
    conversationId: id,
    promptText: item.message.text,
    promptMessageId: item.id,
    startedAt: item.startedAt ?? now,
    completedAt: status === 'running' ? undefined : now,
    status,
    ...steps,
    responsePreview: getResponsePreview(assistant),
  })
}
