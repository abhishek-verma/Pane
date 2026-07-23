import type { UIMessage } from 'ai'
import {
  settleApprovalRequestedOnlyInMessages,
  settleUnresolvedToolApprovalsInMessages,
} from './collect-tool-approval-responses'

type ToolPartLike = {
  type?: string
  state?: string
  errorText?: string
}

function isToolPart(part: unknown): part is ToolPartLike {
  if (!part || typeof part !== 'object') return false
  const type = (part as ToolPartLike).type
  return (
    typeof type === 'string' &&
    (type === 'dynamic-tool' || type.startsWith('tool-'))
  )
}

/**
 * Client-side twin of the server's `settleIncompleteToolParts`. A stream
 * abort (Stop button, navigating away mid-stream) leaves tool parts in
 * `input-streaming` / `input-available` with no result. If the user then
 * sends another message, those parts round-trip back to the server and
 * throw `MissingToolResultsError` on the very next turn — settle them
 * locally first so the UI also stops showing a permanently "running" card.
 */
export function settleIncompleteToolPartsInMessages(
  messages: UIMessage[],
  reason = 'Interrupted before the tool finished',
): UIMessage[] {
  let changed = false
  const next = messages.map((message) => {
    if (message.role !== 'assistant') return message
    let partsChanged = false
    const parts = (message.parts ?? []).map((part) => {
      if (!isToolPart(part)) return part
      if (
        part.state !== 'input-available' &&
        part.state !== 'input-streaming'
      ) {
        return part
      }
      partsChanged = true
      changed = true
      // input-available/input-streaming states have no `output`/`errorText`
      // field in the discriminated UIMessage part union, so the settled
      // output-error shape cannot be typed as a plain union member.
      return {
        ...part,
        state: 'output-error',
        errorText: reason,
      } as unknown as typeof part
    })
    if (!partsChanged) return message
    return { ...message, parts }
  })
  return changed ? (next as UIMessage[]) : messages
}

export type PrepareClientTurnOptions = {
  /** `true`/default: settle all unresolved. `requested-only`: Stop path. */
  settleApprovals?: boolean | 'requested-only'
  settleIncomplete?: boolean
  approvalReason?: string
  incompleteReason?: string
}

/**
 * Client-side chokepoint mirroring the server's `prepareMessagesForAgentTurn`.
 * Call before every `setMessages` that reintroduces a transcript into the
 * active chat: sending a new message, stopping a stream, and restoring a
 * conversation from history.
 */
export function prepareMessagesForClientTurn(
  messages: UIMessage[],
  options: PrepareClientTurnOptions = {},
): UIMessage[] {
  let next = messages
  const settle = options.settleApprovals
  if (settle === 'requested-only') {
    next = settleApprovalRequestedOnlyInMessages(next, options.approvalReason)
  } else if (settle !== false) {
    next = settleUnresolvedToolApprovalsInMessages(next, options.approvalReason)
  }
  if (options.settleIncomplete !== false) {
    next = settleIncompleteToolPartsInMessages(next, options.incompleteReason)
  }
  return next
}
