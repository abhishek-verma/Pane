import { type FC, useCallback, useMemo } from 'react'
import { ToolEvidenceList } from '@/components/tool-evidence/ToolEvidenceList'
import { ApprovalCard, isDryRunPreview } from './ApprovalCard'
import type { ToolInvocationInfo } from './getMessageSegments'

export interface ToolBatchProps {
  tools: ToolInvocationInfo[]
  isLastBatch: boolean
  isLastMessage: boolean
  isStreaming: boolean
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

export const ToolBatch: FC<ToolBatchProps> = ({
  tools,
  isLastBatch,
  isLastMessage,
  isStreaming,
  onApprove,
  onDeny,
  onPromote,
}) => {
  // Approve/Deny (and the resume-failed Retry/Deny variant) are only ever
  // actionable on the last message. A historical turn's tool part cannot be
  // resumed — the SDK only accepts approval responses against the transcript
  // it currently holds — so treating it as actionable there would offer a
  // button that silently no-ops.
  const isActionableState = useCallback(
    (t: ToolInvocationInfo) =>
      isLastMessage &&
      (t.state === 'approval-requested' ||
        t.state === 'approval-responded' ||
        (t.state === 'output-available' && isDryRunPreview(t))),
    [isLastMessage],
  )

  const hasActionableTool = tools.some(isActionableState)
  const preferGenericsOpen =
    isLastMessage && isLastBatch && (isStreaming || hasActionableTool)

  const evidenceTools = useMemo(
    () =>
      tools.map((tool) => {
        const isApproval = isActionableState(tool)
        return {
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          state: tool.state,
          input: tool.input,
          output: tool.output,
          isApproval,
          renderApproval: isApproval
            ? () => (
                <ApprovalCard
                  tool={tool}
                  onApprove={onApprove}
                  onDeny={onDeny}
                  onPromote={onPromote}
                />
              )
            : undefined,
        }
      }),
    [tools, isActionableState, onApprove, onDeny, onPromote],
  )

  return (
    <ToolEvidenceList
      preferGenericsOpen={preferGenericsOpen}
      allowStepReplay={!isStreaming}
      tools={evidenceTools}
    />
  )
}
