import { BotIcon, Play } from 'lucide-react'
import {
  type FC,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Task, TaskContent, TaskTrigger } from '@/components/ai-elements/task'
import { Button } from '@/components/ui/button'
import { buildToolEvidence } from '@/lib/tool-evidence/build-tool-evidence'
import { coalesceConsecutiveFileEdits } from '@/lib/tool-evidence/coalesce-file-edits'
import type { ToolEvidence } from '@/lib/tool-evidence/types'
import { cn } from '@/lib/utils'
import { useOptionalChatSessionContext } from '@/modules/chat/chat-session-context'
import { AppSendCard } from './AppSendCard'
import { BrowserActionCard } from './BrowserActionCard'
import { FileChangeCard } from './FileChangeCard'
import { GenericToolRow } from './GenericToolRow'
import { StepReplayBar } from './StepReplayBar'
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

function SpecializedCard({
  evidence,
  editCount,
  conversationId,
  highlighted,
}: {
  evidence: ToolEvidence
  editCount?: number
  conversationId?: string
  highlighted?: boolean
}) {
  switch (evidence.kind) {
    case 'file-change':
      return (
        <FileChangeCard
          evidence={evidence}
          editCount={editCount}
          conversationId={conversationId}
        />
      )
    case 'terminal':
      return <TerminalCard evidence={evidence} />
    case 'app-send':
      return <AppSendCard evidence={evidence} />
    case 'browser-action':
    case 'screenshot':
      return (
        <BrowserActionCard
          evidence={evidence}
          conversationId={conversationId}
          highlighted={highlighted}
        />
      )
    default:
      return <GenericToolRow evidence={evidence} />
  }
}

export const ToolEvidenceList: FC<{
  tools: ToolEvidenceSource[]
  /** Auto-open generics while streaming last batch */
  preferGenericsOpen?: boolean
  /** Offer step replay when specialized cards >= 2 (completed runs) */
  allowStepReplay?: boolean
  /** Externally controlled highlight (optional; internal replay uses this too) */
  highlightToolCallId?: string
  /** Override conversation id for Action Log links (falls back to chat session) */
  conversationId?: string
}> = ({
  tools,
  preferGenericsOpen = false,
  allowStepReplay = false,
  highlightToolCallId: highlightToolCallIdProp,
  conversationId: conversationIdProp,
}) => {
  const chatSession = useOptionalChatSessionContext()
  const conversationId = conversationIdProp ?? chatSession?.conversationId

  // Parent ChatMessageRow/ToolBatch keep `tools` stable for completed messages.
  const items = useMemo(
    () =>
      tools.map((t) => ({
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
      })),
    [tools],
  )

  const approvals = useMemo(
    () => items.filter((i) => i.source.isApproval),
    [items],
  )
  const specialized = useMemo(
    () => items.filter((i) => !i.source.isApproval && i.evidence.specialized),
    [items],
  )
  const generics = useMemo(
    () => items.filter((i) => !i.source.isApproval && !i.evidence.specialized),
    [items],
  )

  const coalesced = useMemo(
    () => coalesceConsecutiveFileEdits(specialized.map((s) => s.evidence)),
    [specialized],
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
  const canReplay = allowStepReplay && coalesced.length >= 2
  const safeReplayIndex =
    replayIndex != null && replayIndex >= 0 && replayIndex < coalesced.length
      ? replayIndex
      : null

  useEffect(() => {
    if (!canReplay) setReplayIndex(null)
  }, [canReplay])

  const highlightToolCallId =
    highlightToolCallIdProp ??
    (safeReplayIndex != null
      ? coalesced[safeReplayIndex]?.evidence.toolCallId
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
    <div className="flex w-full min-w-0 flex-col gap-[var(--agent-trace-gap)]">
      {canReplay ? (
        safeReplayIndex != null ? (
          <StepReplayBar
            index={safeReplayIndex}
            total={coalesced.length}
            onPrev={() => setReplayIndex((i) => Math.max(0, (i ?? 0) - 1))}
            onNext={() =>
              setReplayIndex((i) =>
                Math.min(coalesced.length - 1, (i ?? 0) + 1),
              )
            }
            onClose={() => setReplayIndex(null)}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-1 text-[11px] text-muted-foreground"
            onClick={() => setReplayIndex(0)}
          >
            <Play className="h-3 w-3" />
            Replay steps
          </Button>
        )
      ) : null}

      {coalesced.map(({ key, evidence, editCount }) => {
        const highlighted = evidence.toolCallId === highlightToolCallId
        return (
          <div
            key={key}
            ref={highlighted ? highlightRef : undefined}
            className={cn(
              'w-full min-w-0',
              highlighted && 'agent-trace-highlight',
            )}
          >
            <SpecializedCard
              evidence={evidence}
              editCount={editCount}
              conversationId={conversationId}
              highlighted={highlighted}
            />
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
