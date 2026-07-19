import { Copy } from 'lucide-react'
import { type FC, useCallback, useMemo } from 'react'
import {
  Message,
  MessageAction,
  MessageActions,
  MessageAttachment,
  MessageAttachments,
  MessageContent,
  MessageResponse,
  MessageToolbar,
} from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import { ToolEvidenceList } from '@/components/tool-evidence/ToolEvidenceList'
import { cn } from '@/lib/utils'
import type {
  AgentChatMessagePart,
  AgentChatMessage as AgentChatMessageType,
} from './agent-chat-types'

function formatCost(usd: number): string {
  if (usd < 0.005) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

type ToolCallPart = Extract<AgentChatMessagePart, { type: 'tool-call' }>
type AttachmentPart = Extract<AgentChatMessagePart, { type: 'attachment' }>

interface RenderEntry {
  kind: 'text' | 'reasoning' | 'meta' | 'task' | 'attachments'
  partIndex: number
  part?: AgentChatMessagePart
  tools?: ToolCallPart[]
  attachments?: AttachmentPart[]
}

/**
 * Build a render plan that groups all tool-call parts into a single Task
 * collapsible and all attachment parts into a single attachment strip at
 * their respective first-appearance positions. Other parts render in place.
 */
function buildRenderEntries(parts: AgentChatMessagePart[]): RenderEntry[] {
  const entries: RenderEntry[] = []
  const tools: ToolCallPart[] = []
  const attachments: AttachmentPart[] = []
  let taskInserted = false
  let attachmentsInserted = false

  parts.forEach((part, partIndex) => {
    if (part.type === 'tool-call') {
      tools.push(part)
      if (!taskInserted) {
        entries.push({ kind: 'task', partIndex, tools })
        taskInserted = true
      }
    } else if (part.type === 'attachment') {
      attachments.push(part)
      if (!attachmentsInserted) {
        entries.push({ kind: 'attachments', partIndex, attachments })
        attachmentsInserted = true
      }
    } else if (part.type === 'text') {
      entries.push({ kind: 'text', partIndex, part })
    } else if (part.type === 'reasoning') {
      entries.push({ kind: 'reasoning', partIndex, part })
    } else if (part.type === 'meta') {
      entries.push({ kind: 'meta', partIndex, part })
    }
  })

  return entries
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  return value as Record<string, unknown>
}

export interface AgentChatMessageProps {
  message: AgentChatMessageType
}

export const AgentChatMessage: FC<AgentChatMessageProps> = ({ message }) => {
  const messageText = message.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n')

  const handleCopy = useCallback(() => {
    if (messageText) navigator.clipboard.writeText(messageText)
  }, [messageText])

  const entries = useMemo(
    () => buildRenderEntries(message.parts),
    [message.parts],
  )

  return (
    <Message
      from={message.role}
      className="max-w-full group-[.is-user]:max-w-[80%]"
    >
      <MessageContent className="max-w-full overflow-hidden group-[.is-assistant]:w-full group-[.is-user]:max-w-full">
        {entries.map((entry) => {
          const key = `${message.id}-entry-${entry.partIndex}`

          if (entry.kind === 'attachments' && entry.attachments) {
            return (
              <MessageAttachments key={key}>
                {entry.attachments.map((attachment, idx) => (
                  <MessageAttachment
                    // biome-ignore lint/suspicious/noArrayIndexKey: attachment order is stable within a finalized message
                    key={`${attachment.kind}-${idx}`}
                    data={{
                      type: 'file',
                      url: attachment.dataUrl ?? '',
                      mediaType: attachment.mediaType,
                      filename: attachment.name,
                    }}
                  />
                ))}
              </MessageAttachments>
            )
          }

          if (entry.kind === 'text' && entry.part?.type === 'text') {
            return (
              <MessageResponse
                key={key}
                // Historical messages are finalized — render immediately.
                // Streamdown's default "streaming" mode uses an idle-callback
                // debounce (300ms / 500ms idle) that paints empty content
                // first, which made history flash blank tool collapsibles
                // before text on every load.
                mode="static"
                parseIncompleteMarkdown={false}
                className={cn(
                  'max-w-full overflow-hidden break-words',
                  '[&_[data-streamdown="code-block"]]:!w-full [&_[data-streamdown="code-block"]]:!max-w-full [&_[data-streamdown="code-block"]]:overflow-x-auto',
                  '[&_[data-streamdown="table-wrapper"]]:!w-full [&_[data-streamdown="table-wrapper"]]:!max-w-full [&_[data-streamdown="table-wrapper"]]:overflow-x-auto',
                  '[&_table]:w-max [&_table]:min-w-full',
                )}
              >
                {entry.part.text}
              </MessageResponse>
            )
          }

          if (entry.kind === 'reasoning' && entry.part?.type === 'reasoning') {
            return (
              <Reasoning
                key={key}
                className="w-full"
                defaultOpen={false}
                duration={entry.part.duration}
              >
                <ReasoningTrigger />
                <ReasoningContent>{entry.part.text}</ReasoningContent>
              </Reasoning>
            )
          }

          if (entry.kind === 'meta' && entry.part?.type === 'meta') {
            return (
              <div key={key} className="text-muted-foreground text-xs">
                {entry.part.label}: {entry.part.value}
              </div>
            )
          }

          if (entry.kind === 'task' && entry.tools) {
            const tools = entry.tools

            return (
              <ToolEvidenceList
                key={key}
                allowStepReplay
                tools={tools.map((tool, idx) => ({
                  toolCallId: `${tool.name}-${idx}`,
                  toolName: tool.name,
                  state: tool.status,
                  input: asRecord(tool.input),
                  output: tool.output,
                  errorText: tool.error,
                  label: tool.label,
                  subject: tool.subject,
                  detailsUnavailable: tool.input == null && tool.output == null,
                }))}
              />
            )
          }

          return null
        })}

        {message.role === 'assistant' && messageText ? (
          <MessageToolbar>
            <MessageActions>
              <MessageAction tooltip="Copy" onClick={handleCopy}>
                <Copy className="size-3.5" />
              </MessageAction>
            </MessageActions>
            {message.costUsd ? (
              <span className="text-[11px] text-muted-foreground/50 tabular-nums">
                {formatCost(message.costUsd)}
              </span>
            ) : null}
          </MessageToolbar>
        ) : null}
      </MessageContent>
    </Message>
  )
}
