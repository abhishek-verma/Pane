import type { UIMessage } from 'ai'
import type { ToolApprovalResponseEntry } from '@/lib/messaging/server/buildChatRequestBody'

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

  const entries: ToolApprovalResponseEntry[] = []
  for (const part of lastMessage.parts) {
    if (!part.type) continue
    const isTool = part.type === 'dynamic-tool' || part.type.startsWith('tool-')
    if (!isTool) continue
    const toolPart = part as {
      toolCallId?: string
      toolName?: string
      state?: string
      input?: Record<string, unknown>
      approval?: { id?: string; approved?: boolean; reason?: string }
    }
    if (
      toolPart.state !== 'approval-responded' ||
      !toolPart.approval?.id ||
      toolPart.approval.approved == null ||
      !toolPart.toolCallId
    ) {
      continue
    }
    entries.push({
      approvalId: toolPart.approval.id,
      toolCallId: toolPart.toolCallId,
      toolName: toolPart.toolName ?? part.type.replace('tool-', ''),
      approved: toolPart.approval.approved,
      input: toolPart.input,
    })
  }
  return entries
}
