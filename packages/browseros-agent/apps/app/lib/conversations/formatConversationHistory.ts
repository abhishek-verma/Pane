import type { UIMessage } from 'ai'

const MAX_MESSAGES = 10
const MAX_MESSAGE_CHARS = 65536

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

function messageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

/**
 * Drop the in-flight user turn from a transcript before building
 * `previousConversation`. The send body already carries `message` for that
 * turn; including it here double-seeds the server (inject + appendUserMessage).
 *
 * Original contract (#263): previousConversation = prior turns only.
 */
export function excludeInFlightUserMessage(
  messages: UIMessage[],
  inFlightUserText: string,
): UIMessage[] {
  if (messages.length === 0) return messages
  const last = messages[messages.length - 1]
  if (last?.role !== 'user') return messages
  if (!inFlightUserText) return messages
  if (messageText(last) !== inFlightUserText) return messages
  return messages.slice(0, -1)
}

export function formatConversationHistory(
  messages: UIMessage[],
): ConversationMessage[] {
  if (messages.length === 0) return []

  const recentMessages = messages.slice(-MAX_MESSAGES)

  return recentMessages
    .map((msg) => {
      if (!msg.parts?.length) return null
      const role: 'user' | 'assistant' =
        msg.role === 'user' ? 'user' : 'assistant'
      const textContent = messageText(msg)

      if (!textContent.trim()) return null

      const content =
        textContent.length > MAX_MESSAGE_CHARS
          ? `${textContent.slice(0, MAX_MESSAGE_CHARS)}... [truncated]`
          : textContent

      return { role, content }
    })
    .filter((msg): msg is ConversationMessage => msg !== null)
}
