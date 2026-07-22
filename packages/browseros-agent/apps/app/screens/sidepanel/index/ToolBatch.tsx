import { type FC, useMemo } from 'react'
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
  const hasActionableTool = tools.some(
    (t) =>
      t.state === 'approval-requested' ||
      (t.state === 'output-available' && isDryRunPreview(t)),
  )
  const preferGenericsOpen =
    isLastMessage && isLastBatch && (isStreaming || hasActionableTool)

  const evidenceTools = useMemo(
    () =>
      tools.map((tool) => {
        const isApproval =
          tool.state === 'approval-requested' ||
          (tool.state === 'output-available' && isDryRunPreview(tool))
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
    [tools, onApprove, onDeny, onPromote],
  )

  return (
    <ToolEvidenceList
      preferGenericsOpen={preferGenericsOpen}
      allowStepReplay={!isStreaming}
      tools={evidenceTools}
    />
  )
}
