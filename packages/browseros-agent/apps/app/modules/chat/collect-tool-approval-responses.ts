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

type SettleApprovalMode = 'all-unresolved' | 'requested-only'

function settleToolApprovalsInMessages(
  messages: UIMessage[],
  mode: SettleApprovalMode,
  reason: string,
): UIMessage[] {
  let changed = false
  const next = messages.map((message) => {
    if (message.role !== 'assistant') return message
    let partsChanged = false
    const parts = (message.parts ?? []).map((part) => {
      if (!isToolPart(part)) return part
      if (!part.approval?.id) return part
      const isRequested = part.state === 'approval-requested'
      const isResponded = part.state === 'approval-responded'
      if (mode === 'requested-only') {
        if (!isRequested) return part
      } else if (!isRequested && !isResponded) {
        return part
      }
      partsChanged = true
      changed = true
      return {
        ...part,
        state: 'output-denied' as const,
        approval: {
          ...part.approval,
          approved: false as const,
          reason,
        },
      } as typeof part
    })
    if (!partsChanged) return message
    return { ...message, parts }
  })
  return changed ? (next as UIMessage[]) : messages
}

/**
 * Auto-deny unresolved tool approvals so a new user turn does not leave
 * Approve/Deny cards stuck or orphan tool-calls without results.
 *
 * Settles both `approval-requested` and `approval-responded` into
 * `output-denied` (same as the server settle path). `approval-responded` alone
 * is only valid for resume turns where the SDK will execute the tool.
 */
export function settleUnresolvedToolApprovalsInMessages(
  messages: UIMessage[],
  reason = 'Superseded by a new user message',
): UIMessage[] {
  return settleToolApprovalsInMessages(messages, 'all-unresolved', reason)
}

/**
 * Stop-path settle: deny unanswered approvals only. Leave
 * `approval-responded` alone so reconcile can sync already-approved tools
 * the server may have executed before the abort landed.
 */
export function settleApprovalRequestedOnlyInMessages(
  messages: UIMessage[],
  reason = 'Interrupted before approval',
): UIMessage[] {
  return settleToolApprovalsInMessages(messages, 'requested-only', reason)
}
