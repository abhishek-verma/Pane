import type { UIMessage } from 'ai'
import type { ChatAction } from '@/lib/chat-actions/types'
import type { ToolInvocationInfo } from './getMessageSegments'

export interface ChatMessageRowProps {
  message: UIMessage
  /** The conversation this message belongs to — passed to PiPageCard so its
   *  agent-driven auto-open can follow the panel to the specific triggering
   *  conversation, never an ambient/global one. */
  conversationId: string
  isLastMessage: boolean
  isStreaming: boolean
  action?: ChatAction
  liked: boolean
  disliked: boolean
  onClickLike: (messageId: string) => void
  onClickDislike: (messageId: string, comment?: string) => void
  onApprove?: (
    approvalId: string,
    tool: ToolInvocationInfo,
    args: Record<string, unknown>,
  ) => void
  onDeny?: (approvalId: string) => void
  onPromote?: (
    tool: ToolInvocationInfo,
    args: Record<string, unknown>,
  ) => void | Promise<void>
}

/**
 * Custom memo compare for ChatMessageRow. Must include Approve/Deny handlers:
 * they close over `approvalResumeInFlight`, and omitting them left the last
 * message row stuck on a stale callback after the first sibling answer
 * (dogfood: second Approve no-op).
 */
export function chatMessageRowPropsEqual(
  prev: ChatMessageRowProps,
  next: ChatMessageRowProps,
): boolean {
  return (
    prev.message === next.message &&
    prev.conversationId === next.conversationId &&
    prev.isLastMessage === next.isLastMessage &&
    prev.isStreaming === next.isStreaming &&
    prev.action === next.action &&
    prev.liked === next.liked &&
    prev.disliked === next.disliked &&
    prev.onApprove === next.onApprove &&
    prev.onDeny === next.onDeny &&
    prev.onPromote === next.onPromote &&
    prev.onClickLike === next.onClickLike &&
    prev.onClickDislike === next.onClickDislike
  )
}
