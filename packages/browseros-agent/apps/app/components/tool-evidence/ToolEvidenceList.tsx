import { BotIcon } from 'lucide-react'
import { type FC, type ReactNode, useEffect, useState } from 'react'
import { Task, TaskContent, TaskTrigger } from '@/components/ai-elements/task'
import { buildToolEvidence } from '@/lib/tool-evidence/build-tool-evidence'
import type { ToolEvidence } from '@/lib/tool-evidence/types'
import { BrowserActionCard } from './BrowserActionCard'
import { FileChangeCard } from './FileChangeCard'
import { GenericToolRow } from './GenericToolRow'
import { TerminalCard } from './TerminalCard'

export interface ToolEvidenceSource {
  toolCallId: string
  toolName: string
  state: string
  input?: Record<string, unknown>
  output?: unknown
  errorText?: string
  label?: string
  subject?: string
  detailsUnavailable?: boolean
  /** When true, caller renders ApprovalCard instead of evidence */
  isApproval?: boolean
  renderApproval?: () => ReactNode
}

function SpecializedCard({ evidence }: { evidence: ToolEvidence }) {
  switch (evidence.kind) {
    case 'file-change':
      return <FileChangeCard evidence={evidence} />
    case 'terminal':
      return <TerminalCard evidence={evidence} />
    case 'browser-action':
    case 'screenshot':
      return <BrowserActionCard evidence={evidence} />
    default:
      return <GenericToolRow evidence={evidence} />
  }
}

export const ToolEvidenceList: FC<{
  tools: ToolEvidenceSource[]
  /** Auto-open generics while streaming last batch */
  preferGenericsOpen?: boolean
}> = ({ tools, preferGenericsOpen = false }) => {
  const items = tools.map((t) => ({
    source: t,
    evidence: buildToolEvidence({
      toolCallId: t.toolCallId,
      toolName: t.toolName,
      state: t.state,
      input: t.input,
      output: t.output,
      errorText: t.errorText,
      label: t.label,
      subject: t.subject,
      detailsUnavailable: t.detailsUnavailable,
    }),
  }))

  const approvals = items.filter((i) => i.source.isApproval)
  const specialized = items.filter(
    (i) => !i.source.isApproval && i.evidence.specialized,
  )
  const generics = items.filter(
    (i) => !i.source.isApproval && !i.evidence.specialized,
  )

  const errorCount = generics.filter((g) => g.evidence.state === 'error').length
  const genericsTitle =
    generics.length === 0
      ? ''
      : errorCount > 0
        ? `${generics.length} more steps · ${errorCount} errors`
        : `${generics.length} more steps`

  const [genericsOpen, setGenericsOpen] = useState(preferGenericsOpen)
  useEffect(() => {
    if (preferGenericsOpen) setGenericsOpen(true)
  }, [preferGenericsOpen])

  return (
    <div className="space-y-2">
      {specialized.map(({ evidence }) => (
        <SpecializedCard key={evidence.toolCallId} evidence={evidence} />
      ))}

      {approvals.map((a) => (
        <div key={a.source.toolCallId}>{a.source.renderApproval?.()}</div>
      ))}

      {generics.length > 0 ? (
        <Task open={genericsOpen} onOpenChange={setGenericsOpen}>
          <TaskTrigger title={genericsTitle} TriggerIcon={BotIcon} />
          <TaskContent>
            {generics.map(({ evidence }) => (
              <GenericToolRow key={evidence.toolCallId} evidence={evidence} />
            ))}
          </TaskContent>
        </Task>
      ) : null}
    </div>
  )
}

/** @internal test helper */
export function partitionEvidence(list: ToolEvidence[]) {
  return {
    specialized: list.filter((e) => e.specialized),
    generics: list.filter((e) => !e.specialized),
  }
}
