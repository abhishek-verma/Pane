import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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

function parseEditedArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export interface ApprovalCardProps {
  tool: ToolInvocationInfo
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

export const ApprovalCard: FC<ApprovalCardProps> = ({
  tool,
  onApprove,
  onDeny,
  onPromote,
}) => {
  const preview = extractOutputText(tool.output)
  const waitingApproval = tool.state === 'approval-requested'
  const dryRun = tool.state === 'output-available' && isDryRunPreview(tool)
  const [editing, setEditing] = useState(false)
  const [argsText, setArgsText] = useState('')
  const [argsError, setArgsError] = useState<string | null>(null)

  useEffect(() => {
    setArgsText(JSON.stringify(tool.input ?? {}, null, 2))
    setArgsError(null)
  }, [tool.input])

  if (!waitingApproval && !dryRun) return null

  const resolveArgs = (): Record<string, unknown> | null => {
    if (!editing) return tool.input
    const parsed = parseEditedArgs(argsText)
    if (!parsed) {
      setArgsError('Args must be valid JSON object')
      return null
    }
    setArgsError(null)
    return parsed
  }

  const handleApprove = () => {
    const id = tool.approval?.id
    if (!id) return
    const args = resolveArgs()
    if (!args) return
    onApprove?.(id, tool, args)
  }

  const handlePromote = () => {
    const args = resolveArgs()
    if (!args) return
    void onPromote?.(tool, args)
  }

  return (
    <div className="mt-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
      {preview && (
        <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap text-xs">
          {preview}
        </pre>
      )}
      <div className="mb-3 space-y-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? 'Hide args' : 'Edit args'}
        </Button>
        {editing && (
          <>
            <Textarea
              value={argsText}
              onChange={(event) => {
                setArgsText(event.target.value)
                setArgsError(null)
              }}
              className="min-h-28 font-mono text-xs"
              spellCheck={false}
            />
            {argsError && (
              <p className="text-destructive text-xs">{argsError}</p>
            )}
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {waitingApproval && tool.approval?.id && (
          <>
            <Button size="sm" onClick={handleApprove}>
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
            <Button size="sm" onClick={handlePromote}>
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
