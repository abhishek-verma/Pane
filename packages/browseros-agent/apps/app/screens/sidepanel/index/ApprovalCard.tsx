import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import type { ToolInvocationInfo } from './getMessageSegments'

function extractOutputText(output: unknown): string {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    return output
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: string }).text ?? '')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (output && typeof output === 'object') {
    if ('text' in output)
      return String((output as { text?: string }).text ?? '')
    if (
      'content' in output &&
      Array.isArray((output as { content: unknown }).content)
    ) {
      return extractOutputText((output as { content: unknown[] }).content)
    }
  }
  return ''
}

export function isDryRunPreview(tool: ToolInvocationInfo): boolean {
  const text = extractOutputText(tool.output)
  return (
    text.startsWith('Dry-run.') ||
    text.startsWith('Needs approval:') ||
    text.includes('Blast-radius cap reached')
  )
}

export interface ApprovalCardProps {
  tool: ToolInvocationInfo
  onApprove?: (approvalId: string) => void
  onDeny?: (approvalId: string) => void
  onPromote?: (tool: ToolInvocationInfo) => void
}

export const ApprovalCard: FC<ApprovalCardProps> = ({
  tool,
  onApprove,
  onDeny,
  onPromote,
}) => {
  const preview = extractOutputText(tool.output)
  const waitingApproval = tool.state === 'approval-requested'
  const dryRun = tool.state === 'output-available' && isDryRunPreview(tool)

  if (!waitingApproval && !dryRun) return null

  return (
    <div className="mt-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
      {preview && (
        <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap text-xs">
          {preview}
        </pre>
      )}
      <div className="flex flex-wrap gap-2">
        {waitingApproval && tool.approval?.id && (
          <>
            <Button
              size="sm"
              onClick={() => {
                const id = tool.approval?.id
                if (id) onApprove?.(id)
              }}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const id = tool.approval?.id
                if (id) onDeny?.(id)
              }}
            >
              Deny
            </Button>
          </>
        )}
        {dryRun && (
          <>
            <Button size="sm" onClick={() => onPromote?.(tool)}>
              Promote
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDeny?.(tool.toolCallId)}
            >
              Deny
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
