import type { UIMessage } from 'ai'
import {
  collectToolApprovalResponses,
  hasPendingToolApprovals,
} from '@/modules/chat/collect-tool-approval-responses'
import { composerKey, updateComposer } from '@/modules/chat/composer-store'
import { durableChatRequest } from './queue-request'
import type { ChatRepository } from './repository'
import type { PreparedChatRequest } from './types'

export interface ApprovalDecision {
  id: string
  approved: boolean
  input?: Record<string, unknown>
}
export const approvalKey = (id: string) => `chat-approvals-v1:${id}`
export function applyApprovalDecisions(
  messages: UIMessage[],
  decisions: ApprovalDecision[],
): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (!('approval' in part) || !part.approval || !('state' in part))
        return part
      if (
        part.state !== 'approval-requested' &&
        part.state !== 'approval-responded'
      )
        return part
      const decision = decisions.find((item) => item.id === part.approval?.id)
      if (!decision) return part
      return {
        ...part,
        state: 'approval-responded',
        approval: { ...part.approval, approved: decision.approved },
        ...(decision.input
          ? { input: decision.input, inputPreviewed: false }
          : {}),
      } as typeof part
    }),
  }))
}
export async function restoreApprovalDecisions(
  id: string,
  messages: UIMessage[],
) {
  const decisions = (await chrome.storage.local.get(approvalKey(id)))[
    approvalKey(id)
  ] as ApprovalDecision[] | undefined
  return decisions?.length
    ? applyApprovalDecisions(messages, decisions)
    : messages
}
export async function submitRepositoryApproval(
  repository: ChatRepository,
  id: string,
  decision: ApprovalDecision,
  request: PreparedChatRequest,
) {
  await navigator.locks.request(`chat-command:${id}`, async () => {
    const state = await repository.read(id)
    if (state.busy)
      throw new Error('Wait for the running turn before changing approvals.')
    const parts = state.messages.at(-1)?.parts ?? []
    const current = parts.find(
      (part) => 'approval' in part && part.approval?.id === decision.id,
    )
    if (
      !current ||
      !('state' in current) ||
      !['approval-requested', 'approval-responded'].includes(
        current.state ?? '',
      )
    )
      throw new Error(
        'This approval is no longer pending. Refresh the conversation.',
      )
    const key = approvalKey(id)
    const previous = ((await chrome.storage.local.get(key))[key] ??
      []) as ApprovalDecision[]
    const existing = previous.find((item) => item.id === decision.id)
    if (
      existing &&
      (existing.approved !== decision.approved ||
        JSON.stringify(existing.input) !== JSON.stringify(decision.input))
    )
      throw new Error(
        'Another view already answered this approval differently. Refresh before continuing.',
      )
    const decisions = existing ? previous : [...previous, decision]
    await chrome.storage.local.set({ [key]: decisions })
    const messages = applyApprovalDecisions(state.messages, decisions)
    repository.setApprovalMessages(id, messages)
    if (hasPendingToolApprovals(messages)) return
    const responses = collectToolApprovalResponses(messages)
    if (!responses.length) return
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        responses
          .map((item) => item.approvalId)
          .sort()
          .join('\n'),
      ),
    )
    const messageId = `approval-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
    await updateComposer(composerKey(id), (value) => {
      const existing = value.queue.find((item) => item.id === messageId)
      if (existing) {
        if (existing.state !== 'review' || existing.started) return value
        return {
          ...value,
          paused: false,
          note: undefined,
          queue: value.queue.map((item) =>
            item.id === messageId ? { ...item, state: 'queued' } : item,
          ),
        }
      }
      return {
        ...value,
        paused: false,
        note: undefined,
        queue: [
          {
            id: messageId,
            kind: 'approval',
            pauseAfter: value.paused,
            state: 'queued',
            message: { text: '' },
            prepared: durableChatRequest({
              path: request.path,
              body: {
                ...request.body,
                message: '',
                attachments: undefined,
                revision: undefined,
                toolApprovalResponses: responses,
              },
            }),
          },
          ...value.queue,
        ],
      }
    })
  })
}
