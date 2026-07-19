import type { UIMessage } from 'ai'
import { Bot } from 'lucide-react'
import { type FC, Fragment } from 'react'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import type { ChatAction } from '@/lib/chat-actions/types'
import { ChatMessageActions } from './ChatMessageActions'
import { ConnectAppCard } from './ConnectAppCard'
import { getMessageSegments } from './getMessageSegments'
import { ScheduleSuggestionCard } from './ScheduleSuggestionCard'
import { ToolBatch } from './ToolBatch'
import { UserActionMessage } from './UserActionMessage'

export interface ChatMessagesProps {
  messages: UIMessage[]
  status: 'streaming' | 'submitted' | 'ready' | 'error'
  getActionForMessage?: (message: UIMessage) => ChatAction | undefined
  liked: Record<string, boolean>
  onClickLike: (messageId: string) => void
  disliked: Record<string, boolean>
  onClickDislike: (messageId: string, comment?: string) => void
  onApprove?: (
    approvalId: string,
    tool: import('./getMessageSegments').ToolInvocationInfo,
    args: Record<string, unknown>,
  ) => void
  onDeny?: (approvalId: string) => void
  onPromote?: (
    tool: import('./getMessageSegments').ToolInvocationInfo,
    args: Record<string, unknown>,
  ) => void | Promise<void>
}

export const ChatMessages: FC<ChatMessagesProps> = ({
  messages,
  status,
  getActionForMessage,
  liked,
  disliked,
  onClickLike,
  onClickDislike,
  onApprove,
  onDeny,
  onPromote,
}) => {
  const isStreaming = status === 'streaming' || status === 'submitted'

  return (
    <>
      <Conversation className="ph-mask">
        <ConversationContent>
          {messages.map((message, messageIndex) => {
            const action = getActionForMessage?.(message)
            const isLastMessage = messageIndex === messages.length - 1
            const segments = getMessageSegments(
              message,
              isLastMessage,
              isStreaming,
            )
            const toolBatches = segments.filter((s) => s.type === 'tool-batch')
            const lastToolBatchKey = toolBatches[toolBatches.length - 1]?.key

            const messageText = segments
              ?.filter((each) => each.type === 'text')
              ?.map((each) => each.text)
              ?.join('\n\n')

            const likeAction = () => onClickLike(message.id)
            const dislikeAction = (comment?: string) =>
              onClickDislike(message.id, comment)

            return (
              <Fragment key={message.id}>
                <Message from={message.role}>
                  <MessageContent>
                    {action ? (
                      <UserActionMessage action={action} />
                    ) : (
                      segments.map((segment) => {
                        switch (segment.type) {
                          case 'text':
                            return (
                              <MessageResponse key={segment.key}>
                                {segment.text}
                              </MessageResponse>
                            )
                          case 'reasoning':
                            return (
                              <Reasoning
                                key={segment.key}
                                className="w-full"
                                isStreaming={segment.isStreaming}
                              >
                                <ReasoningTrigger />
                                <ReasoningContent>
                                  {segment.text}
                                </ReasoningContent>
                              </Reasoning>
                            )
                          case 'tool-batch':
                            return (
                              <ToolBatch
                                key={segment.key}
                                tools={segment.tools}
                                isLastBatch={segment.key === lastToolBatchKey}
                                isLastMessage={isLastMessage}
                                isStreaming={isStreaming}
                                onApprove={onApprove}
                                onDeny={onDeny}
                                onPromote={onPromote}
                              />
                            )
                          case 'nudge':
                            return segment.nudgeType ===
                              'schedule_suggestion' ? (
                              <ScheduleSuggestionCard
                                key={segment.key}
                                data={segment.data}
                                isLastMessage={isLastMessage}
                              />
                            ) : (
                              <ConnectAppCard
                                key={segment.key}
                                data={segment.data}
                                isLastMessage={isLastMessage}
                              />
                            )
                          default:
                            return null
                        }
                      })
                    )}
                  </MessageContent>
                </Message>
                {message.role === 'assistant' &&
                (!isLastMessage || !isStreaming) ? (
                  <ChatMessageActions
                    messageId={message.id}
                    messageText={messageText}
                    liked={liked[message.id] ?? false}
                    disliked={disliked[message.id] ?? false}
                    onClickLike={likeAction}
                    onClickDislike={dislikeAction}
                  />
                ) : null}
              </Fragment>
            )
          })}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {isStreaming && (
        <div className="flex animate-fadeInUp items-center gap-2 px-3 py-1">
          <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="agent-typing" role="status">
            <span className="sr-only">Agent is typing</span>
            <span className="agent-typing-dot" />
            <span className="agent-typing-dot" />
            <span className="agent-typing-dot" />
          </div>
        </div>
      )}
      <div />
    </>
  )
}
