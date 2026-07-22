import type { UIMessage } from 'ai'
import type { ToolApprovalResponseEntry } from '@/lib/messaging/server/buildChatRequestBody'

type ToolPartLike = {
  type?: string
  toolCallId?: string
  toolName?: string
  state?: string
  input?: Record<string, unknown>
  approval?: { id?: string; approved?: boolean; reason?: string }
}

function isToolPart(part: unknown): part is ToolPartLike {
  if (!part || typeof part !== 'object') return false
  const type = (part as ToolPartLike).type
  return (
    typeof type === 'string' &&
    (type === 'dynamic-tool' || type.startsWith('tool-'))
  )
}

function toolNameOf(part: ToolPartLike): string {
  if (typeof part.toolName === 'string' && part.toolName.length > 0) {
    return part.toolName
  }
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    return part.type.slice('tool-'.length)
  }
  return 'unknown'
}

function collectRespondedFromMessage(
  message: UIMessage,
): ToolApprovalResponseEntry[] {
  const entries: ToolApprovalResponseEntry[] = []
  for (const part of message.parts ?? []) {
    if (!isToolPart(part)) continue
    if (
      part.state !== 'approval-responded' ||
      !part.approval?.id ||
      part.approval.approved == null ||
      !part.toolCallId
    ) {
      continue
    }
    entries.push({
      approvalId: part.approval.id,
      toolCallId: part.toolCallId,
      toolName: toolNameOf(part),
      approved: part.approval.approved,
      input: part.input,
    })
  }
  return entries
}

/**
 * Collects pending tool-approval decisions from the latest assistant turn only.
 * Used on approval-resume requests so the server can replay them into its
 * stored transcript (the custom transport drops AI SDK approval-response parts).
 */
export function collectToolApprovalResponses(
  messages: UIMessage[],
): ToolApprovalResponseEntry[] {
  const lastMessage = messages[messages.length - 1]
  if (lastMessage?.role !== 'assistant' || !lastMessage.parts) return []
  return collectRespondedFromMessage(lastMessage)
}

/** True when any assistant tool part is still waiting on Approve/Deny. */
export function hasPendingToolApprovals(messages: UIMessage[]): boolean {
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts ?? []) {
      if (!isToolPart(part)) continue
      if (part.state === 'approval-requested' && part.approval?.id) return true
    }
  }
  return false
}

/**
 * Auto-deny every remaining `approval-requested` tool part so a new user turn
 * does not leave Approve/Deny cards stuck in the UI.
 *
 * Uses `output-denied` so convertToModelMessages emits a tool-result (same as
 * the server settle path). `approval-responded` alone is only for resume turns.
 */
export function settleUnresolvedToolApprovalsInMessages(
  messages: UIMessage[],
  reason = 'Superseded by a new user message',
): UIMessage[] {
  let changed = false
  const next = messages.map((message) => {
    if (message.role !== 'assistant') return message
    let partsChanged = false
    const parts = (message.parts ?? []).map((part) => {
      if (!isToolPart(part)) return part
      if (part.state !== 'approval-requested' || !part.approval?.id) return part
      partsChanged = true
      changed = true
      return {
        ...part,
        state: 'output-denied',
        approval: {
          ...part.approval,
          approved: false,
          reason,
        },
      }
    })
    if (!partsChanged) return message
    return { ...message, parts }
  })
  return changed ? next : messages
}
