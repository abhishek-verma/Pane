import { Bot } from 'lucide-react'
import { type FC, useMemo } from 'react'
import {
  Message,
  MessageAttachment,
  MessageAttachments,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import { ToolEvidenceList } from '@/components/tool-evidence/ToolEvidenceList'
import type {
  AgentConversationTurn,
  ToolEntry,
} from '@/lib/agent-conversations/types'

export interface ConversationMessageProps {
  turn: AgentConversationTurn
  streaming: boolean
}

interface RenderEntry {
  kind: 'thinking' | 'text' | 'task'
  partIndex: number
  text?: string
  done?: boolean
  tools?: ToolEntry[]
}

/**
 * Build the render plan for an assistant turn:
 * - thinking and text parts render in place
 * - all tool-batch parts collapse into a single Task entry at their first
 *   appearance position, with tools listed in arrival order
 */
function buildRenderEntries(turn: AgentConversationTurn): RenderEntry[] {
  const entries: RenderEntry[] = []
  const aggregatedTools: ToolEntry[] = []
  let taskInserted = false

  turn.parts.forEach((part, partIndex) => {
    if (part.kind === 'thinking') {
      entries.push({
        kind: 'thinking',
        partIndex,
        text: part.text,
        done: part.done,
      })
    } else if (part.kind === 'text') {
      entries.push({ kind: 'text', partIndex, text: part.text })
    } else if (part.kind === 'tool-batch') {
      aggregatedTools.push(...part.tools)
      if (!taskInserted) {
        entries.push({
          kind: 'task',
          partIndex,
          tools: aggregatedTools,
        })
        taskInserted = true
      }
    }
  })

  return entries
}

export const ConversationMessage: FC<ConversationMessageProps> = ({
  turn,
  streaming,
}) => {
  const entries = useMemo(() => buildRenderEntries(turn), [turn])

  return (
    <div className="space-y-3">
      <Message from="user">
        <MessageContent>
          {turn.userAttachments && turn.userAttachments.length > 0 && (
            <MessageAttachments>
              {turn.userAttachments.map((attachment) => (
                <MessageAttachment
                  key={attachment.id}
                  data={{
                    type: 'file',
                    url: attachment.dataUrl ?? '',
                    mediaType: attachment.mediaType,
                    filename: attachment.name,
                  }}
                />
              ))}
            </MessageAttachments>
          )}
          {turn.userText && (
            <pre className="whitespace-pre-wrap font-sans text-sm">
              {turn.userText}
            </pre>
          )}
        </MessageContent>
      </Message>

      {entries.length > 0 && (
        <Message from="assistant">
          <MessageContent>
            {entries.map((entry) => {
              const key = `${turn.id}-entry-${entry.partIndex}`

              if (entry.kind === 'thinking') {
                return (
                  <Reasoning
                    key={key}
                    className="w-full"
                    isStreaming={!entry.done}
                    defaultOpen={!entry.done}
                  >
                    <ReasoningTrigger />
                    <ReasoningContent>{entry.text ?? ''}</ReasoningContent>
                  </Reasoning>
                )
              }

              if (entry.kind === 'text') {
                return (
                  <MessageResponse key={key}>
                    {entry.text ?? ''}
                  </MessageResponse>
                )
              }

              const tools = entry.tools ?? []

              return (
                <ToolEvidenceList
                  key={key}
                  preferGenericsOpen={!turn.done}
                  allowStepReplay={turn.done}
                  tools={tools.map((tool) => ({
                    toolCallId: tool.id,
                    toolName: tool.name,
                    state: tool.status,
                    input: tool.input,
                    output: tool.output,
                    errorText: tool.error,
                    label: tool.label,
                    subject: tool.subject,
                    detailsUnavailable:
                      tool.input == null && tool.output == null,
                  }))}
                />
              )
            })}
          </MessageContent>
        </Message>
      )}

      {!turn.done && turn.parts.length === 0 && streaming && (
        <div className="flex gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-orange)] text-white">
            <Bot className="size-3.5" />
          </div>
          <div className="flex items-center gap-1 rounded-xl rounded-tl-none border border-border/50 bg-card px-3 py-2.5 shadow-sm">
            <span className="size-1.5 animate-bounce rounded-full bg-[var(--accent-orange)] [animation-delay:-0.3s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-[var(--accent-orange)] [animation-delay:-0.15s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-[var(--accent-orange)]" />
          </div>
        </div>
      )}
    </div>
  )
}
