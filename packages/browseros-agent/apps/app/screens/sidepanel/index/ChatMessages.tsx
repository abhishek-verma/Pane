import type { UIMessage } from 'ai'
import { Bot } from 'lucide-react'
import {
  type FC,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
import {
  getMessageWindowSlice,
  growMessageWindow,
  MESSAGE_WINDOW_SIZE,
} from './message-window'
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

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null
  while (cur) {
    const { overflowY } = getComputedStyle(cur)
    if (
      overflowY === 'auto' ||
      overflowY === 'scroll' ||
      overflowY === 'overlay'
    ) {
      return cur
    }
    cur = cur.parentElement
  }
  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : null
}

interface ChatMessageRowProps {
  message: UIMessage
  isLastMessage: boolean
  isStreaming: boolean
  action?: ChatAction
  liked: boolean
  disliked: boolean
  onClickLike: (messageId: string) => void
  onClickDislike: (messageId: string, comment?: string) => void
  onApprove?: ChatMessagesProps['onApprove']
  onDeny?: ChatMessagesProps['onDeny']
  onPromote?: ChatMessagesProps['onPromote']
}

function chatMessageRowPropsEqual(
  prev: ChatMessageRowProps,
  next: ChatMessageRowProps,
): boolean {
  return (
    prev.message === next.message &&
    prev.isLastMessage === next.isLastMessage &&
    prev.isStreaming === next.isStreaming &&
    prev.action === next.action &&
    prev.liked === next.liked &&
    prev.disliked === next.disliked
  )
}

const ChatMessageRow = memo(function ChatMessageRow({
  message,
  isLastMessage,
  isStreaming,
  action,
  liked,
  disliked,
  onClickLike,
  onClickDislike,
  onApprove,
  onDeny,
  onPromote,
}: ChatMessageRowProps) {
  const segments = useMemo(
    () => getMessageSegments(message, isLastMessage, isStreaming),
    [message, isLastMessage, isStreaming],
  )
  const toolBatches = segments.filter((s) => s.type === 'tool-batch')
  const lastToolBatchKey = toolBatches[toolBatches.length - 1]?.key

  const messageText = segments
    .filter((each) => each.type === 'text')
    .map((each) => each.text)
    .join('\n\n')

  return (
    <div
      className="w-full min-w-0"
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 120px',
      }}
    >
      <Message from={message.role}>
        <MessageContent>
          {action ? (
            <UserActionMessage action={action} />
          ) : (
            segments.map((segment) => {
              switch (segment.type) {
                case 'text':
                  return (
                    <MessageResponse
                      key={segment.key}
                      // Completed segments stay static so Streamdown
                      // does not re-parse every token / load mermaid.
                      mode={segment.isStreaming ? 'streaming' : 'static'}
                      parseIncompleteMarkdown={segment.isStreaming}
                      // Keep mermaid plugin off the side-panel hot path
                      // (Crashpad OOM last-alloc was mermaid chunk).
                      plugins={{}}
                    >
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
                      <ReasoningContent>{segment.text}</ReasoningContent>
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
                  return segment.nudgeType === 'schedule_suggestion' ? (
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
      {message.role === 'assistant' && (!isLastMessage || !isStreaming) ? (
        <ChatMessageActions
          messageId={message.id}
          messageText={messageText}
          liked={liked}
          disliked={disliked}
          onClickLike={() => onClickLike(message.id)}
          onClickDislike={(comment?: string) =>
            onClickDislike(message.id, comment)
          }
        />
      ) : null}
    </div>
  )
}, chatMessageRowPropsEqual)

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
  const [windowSize, setWindowSize] = useState(MESSAGE_WINDOW_SIZE)
  const topSentinelRef = useRef<HTMLDivElement | null>(null)
  const scrollRestoreRef = useRef<{
    prevHeight: number
    prevTop: number
  } | null>(null)
  // Reset the window when the conversation identity changes (first message id).
  const conversationKey = messages[0]?.id ?? 'empty'
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when conversation identity changes
  useEffect(() => {
    setWindowSize(MESSAGE_WINDOW_SIZE)
  }, [conversationKey])

  const { hiddenCount } = getMessageWindowSlice({
    total: messages.length,
    windowSize,
  })
  const visibleMessages = useMemo(
    () => (hiddenCount > 0 ? messages.slice(hiddenCount) : messages),
    [messages, hiddenCount],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: restore scroll after windowSize grows
  useLayoutEffect(() => {
    const pending = scrollRestoreRef.current
    if (!pending) return
    const scrollEl = findScrollParent(topSentinelRef.current)
    if (scrollEl) {
      const delta = scrollEl.scrollHeight - pending.prevHeight
      scrollEl.scrollTop = pending.prevTop + delta
    }
    scrollRestoreRef.current = null
  }, [windowSize])

  useEffect(() => {
    const sentinel = topSentinelRef.current
    if (!sentinel || hiddenCount <= 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        const scrollEl = findScrollParent(sentinel)
        if (scrollEl) {
          scrollRestoreRef.current = {
            prevHeight: scrollEl.scrollHeight,
            prevTop: scrollEl.scrollTop,
          }
        }
        setWindowSize((prev) =>
          growMessageWindow({ current: prev, total: messages.length }),
        )
      },
      {
        root: null,
        rootMargin: '160px 0px 0px 0px',
        threshold: 0,
      },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hiddenCount, messages.length])

  return (
    <>
      <Conversation className="ph-mask">
        <ConversationContent>
          {hiddenCount > 0 ? (
            <div
              ref={topSentinelRef}
              className="h-1 w-full shrink-0"
              aria-hidden
            />
          ) : null}
          {visibleMessages.map((message, visibleIndex) => {
            const messageIndex = hiddenCount + visibleIndex
            const isLastMessage = messageIndex === messages.length - 1
            return (
              <ChatMessageRow
                key={message.id}
                message={message}
                isLastMessage={isLastMessage}
                isStreaming={isStreaming}
                action={getActionForMessage?.(message)}
                liked={liked[message.id] ?? false}
                disliked={disliked[message.id] ?? false}
                onClickLike={onClickLike}
                onClickDislike={onClickDislike}
                onApprove={onApprove}
                onDeny={onDeny}
                onPromote={onPromote}
              />
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
