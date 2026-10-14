import type { ChatStatus, UIMessage } from 'ai'
import { useCallback, useRef } from 'react'
import {
  getResponsePreview,
  normalizeExecutionSteps,
} from '@/lib/execution-history/normalize'
import { upsertConversationExecutionTask } from '@/lib/execution-history/storage'
import type {
  ExecutionTaskRecord,
  ExecutionTaskStatus,
} from '@/lib/execution-history/types'
import { ExecutionHistoryWriteBuffer } from '@/lib/execution-history/write-buffer'
import { sentry } from '@/lib/sentry/sentry'

interface StartExecutionTaskInput {
  conversationId: string
  promptText: string
}

interface FinishExecutionTaskInput {
  responseText?: string
  isAbort?: boolean
  isError?: boolean
}

function createTask(input: StartExecutionTaskInput): ExecutionTaskRecord {
  return {
    id: crypto.randomUUID(),
    conversationId: input.conversationId,
    promptText: input.promptText,
    startedAt: new Date().toISOString(),
    status: 'running',
    actionCount: 0,
    approvalCount: 0,
    deniedCount: 0,
    errorCount: 0,
    steps: [],
  }
}

function getLastUserMessage(messages: UIMessage[]): UIMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') {
      return messages[index]
    }
  }
}

function getLastAssistantMessage(messages: UIMessage[]): UIMessage | undefined {
  const lastMessage = messages[messages.length - 1]
  if (lastMessage?.role === 'assistant') {
    return lastMessage
  }
}

function getFinishedStatus(
  input: FinishExecutionTaskInput,
): ExecutionTaskStatus {
  if (input.isError) return 'failed'
  if (input.isAbort) return 'stopped'
  return 'completed'
}

export function useExecutionHistoryTracker() {
  const activeTaskRef = useRef<ExecutionTaskRecord | null>(null)
  const writerRef = useRef<ExecutionHistoryWriteBuffer | null>(null)
  if (!writerRef.current) {
    writerRef.current = new ExecutionHistoryWriteBuffer(
      upsertConversationExecutionTask,
      (error, task) =>
        sentry.captureException(error, {
          extra: {
            message: 'Failed to persist execution history task',
            conversationId: task.conversationId,
            taskId: task.id,
          },
        }),
    )
  }

  const persistTask = useCallback((task: ExecutionTaskRecord) => {
    activeTaskRef.current = task
    writerRef.current?.enqueue(task)
  }, [])

  const startTask = useCallback(
    (input: StartExecutionTaskInput) => {
      const task = createTask(input)
      persistTask(task)
      return task.id
    },
    [persistTask],
  )

  const syncFromMessages = useCallback(
    (messages: UIMessage[], _status: ChatStatus) => {
      const activeTask = activeTaskRef.current
      if (!activeTask) return

      const promptMessage = getLastUserMessage(messages)
      const assistantMessage = getLastAssistantMessage(messages)
      const normalized = normalizeExecutionSteps({
        assistantMessage,
        previousSteps: activeTask.steps,
        nowIso: new Date().toISOString(),
      })

      persistTask({
        ...activeTask,
        promptMessageId: activeTask.promptMessageId ?? promptMessage?.id,
        assistantMessageId:
          normalized.assistantMessageId ?? activeTask.assistantMessageId,
        responsePreview:
          getResponsePreview(assistantMessage) || activeTask.responsePreview,
        actionCount: normalized.actionCount,
        approvalCount: normalized.approvalCount,
        deniedCount: normalized.deniedCount,
        errorCount: normalized.errorCount,
        steps: normalized.steps,
      })
    },
    [persistTask],
  )

  const finishTask = useCallback(
    async (input: FinishExecutionTaskInput) => {
      const activeTask = activeTaskRef.current
      if (!activeTask) return

      const responseText = input.responseText?.trim() || activeTask.responseText
      const nextTask: ExecutionTaskRecord = {
        ...activeTask,
        completedAt: new Date().toISOString(),
        status: getFinishedStatus(input),
        responseText,
        responsePreview: responseText
          ? getResponsePreview({
              parts: [{ type: 'text', text: responseText }],
            } as Pick<UIMessage, 'parts'>)
          : activeTask.responsePreview,
      }

      persistTask(nextTask)
      activeTaskRef.current = null
    },
    [persistTask],
  )

  const clearActiveTask = useCallback(() => {
    activeTaskRef.current = null
  }, [])

  return {
    startTask,
    syncFromMessages,
    finishTask,
    clearActiveTask,
  }
}
