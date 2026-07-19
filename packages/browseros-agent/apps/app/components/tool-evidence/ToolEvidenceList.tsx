import { BotIcon, Play } from 'lucide-react'
import { type FC, type ReactNode, useEffect, useRef, useState } from 'react'
import { Task, TaskContent, TaskTrigger } from '@/components/ai-elements/task'
import { Button } from '@/components/ui/button'
import { buildToolEvidence } from '@/lib/tool-evidence/build-tool-evidence'
import type { ToolEvidence } from '@/lib/tool-evidence/types'
import { cn } from '@/lib/utils'
import { BrowserActionCard } from './BrowserActionCard'
import { FileChangeCard } from './FileChangeCard'
import { GenericToolRow } from './GenericToolRow'
import { StepReplayBar } from './StepReplayBar'

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

export const ToolEvidenceList: FC<{
  tools: ToolEvidenceSource[]
  /** Auto-open generics while streaming last batch */
  preferGenericsOpen?: boolean
  /** Offer step replay when specialized cards >= 2 (completed runs) */
  allowStepReplay?: boolean
  /** Externally controlled highlight (optional; internal replay uses this too) */
  highlightToolCallId?: string
}> = ({
  tools,
  preferGenericsOpen = false,
  allowStepReplay = false,
  highlightToolCallId: highlightToolCallIdProp,
}) => {
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

  const [replayIndex, setReplayIndex] = useState<number | null>(null)
  const canReplay = allowStepReplay && specialized.length >= 2
  const safeReplayIndex =
    replayIndex != null && replayIndex >= 0 && replayIndex < specialized.length
      ? replayIndex
      : null

  useEffect(() => {
    if (!canReplay) setReplayIndex(null)
  }, [canReplay])

  const highlightToolCallId =
    highlightToolCallIdProp ??
    (safeReplayIndex != null
      ? specialized[safeReplayIndex]?.evidence.toolCallId
      : undefined)

  const highlightRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!highlightToolCallId) return
    highlightRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }, [highlightToolCallId])

  return (
    <div className="space-y-2">
      {canReplay ? (
        safeReplayIndex != null ? (
          <StepReplayBar
            index={safeReplayIndex}
            total={specialized.length}
            onPrev={() => setReplayIndex((i) => Math.max(0, (i ?? 0) - 1))}
            onNext={() =>
              setReplayIndex((i) =>
                Math.min(specialized.length - 1, (i ?? 0) + 1),
              )
            }
            onClose={() => setReplayIndex(null)}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
            onClick={() => setReplayIndex(0)}
          >
            <Play className="h-3 w-3" />
            Replay steps
          </Button>
        )
      ) : null}

      {specialized.map(({ evidence }) => {
        const highlighted = evidence.toolCallId === highlightToolCallId
        return (
          <div
            key={evidence.toolCallId}
            ref={highlighted ? highlightRef : undefined}
            className={cn(
              'rounded-md transition-shadow',
              highlighted &&
                'ring-2 ring-[var(--accent-orange)] ring-offset-1 ring-offset-background',
            )}
          >
            {evidence.kind === 'file-change' ? (
              <FileChangeCard evidence={evidence} />
            ) : (
              <BrowserActionCard evidence={evidence} />
            )}
          </div>
        )
      })}

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
