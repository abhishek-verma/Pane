import type { UIMessage } from 'ai'

export type ToolApprovalDecision = {
  approvalId: string
  toolCallId: string
  toolName: string
  approved: boolean
  reason?: string
  input?: Record<string, unknown>
}

type ToolPartLike = {
  type?: string
  state?: string
  toolCallId?: string
  toolName?: string
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

/**
 * Apply explicit approval decisions onto `approval-requested` tool parts.
 * Idempotent when a part is already `approval-responded` with the same decision.
 * Returns how many parts were newly patched.
 */
export function applyToolApprovalDecisions(
  messages: UIMessage[],
  responses: ToolApprovalDecision[],
): { patched: number; unmatched: string[] } {
  const responseMap = new Map(responses.map((r) => [r.approvalId, r]))
  const matched = new Set<string>()
  let patched = 0

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts) {
      if (!isToolPart(part)) continue
      const approvalId = part.approval?.id
      if (!approvalId || !responseMap.has(approvalId)) continue
      const resp = responseMap.get(approvalId)
      if (!resp) continue
      matched.add(approvalId)

      if (part.state === 'approval-responded') {
        // Idempotent: keep existing decision unless still missing approved flag.
        if (part.approval?.approved == null) {
          part.approval = {
            ...part.approval,
            approved: resp.approved,
            reason: resp.reason,
          }
          patched++
        }
        if (resp.input) part.input = resp.input
        continue
      }

      if (part.state !== 'approval-requested') continue
      part.state = 'approval-responded'
      part.approval = {
        ...part.approval,
        id: approvalId,
        approved: resp.approved,
        reason: resp.reason,
      }
      if (resp.input) part.input = resp.input
      patched++
    }
  }

  const unmatched = responses
    .map((r) => r.approvalId)
    .filter((id) => !matched.has(id))
  return { patched, unmatched }
}

/**
 * Auto-deny every remaining `approval-requested` tool so a new user turn cannot
 * leave orphan tool-calls without results.
 *
 * Must use `output-denied` (not merely `approval-responded`): convertToModelMessages
 * only emits a tool-result for denied tools once state is `output-denied`. The
 * approval-resume path lets the SDK emit that itself; a superseding user turn
 * skips resume, so we materialize the denial here.
 */
export function settleUnresolvedToolApprovals(
  messages: UIMessage[],
  reason = 'Superseded by a new user message',
): number {
  let settled = 0
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts) {
      if (!isToolPart(part)) continue
      if (part.state !== 'approval-requested' || !part.approval?.id) continue
      if (!part.toolCallId) continue
      part.state = 'output-denied'
      part.approval = {
        ...part.approval,
        approved: false,
        reason,
      }
      settled++
    }
  }
  return settled
}

/** Collect still-pending approval-requested parts (for logging / client sync). */
export function listPendingToolApprovals(
  messages: UIMessage[],
): ToolApprovalDecision[] {
  const pending: ToolApprovalDecision[] = []
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts) {
      if (!isToolPart(part)) continue
      if (
        part.state !== 'approval-requested' ||
        !part.approval?.id ||
        !part.toolCallId
      ) {
        continue
      }
      pending.push({
        approvalId: part.approval.id,
        toolCallId: part.toolCallId,
        toolName: toolNameOf(part),
        approved: false,
      })
    }
  }
  return pending
}
