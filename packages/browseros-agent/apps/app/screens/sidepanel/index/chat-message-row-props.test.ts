import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  type ChatMessageRowProps,
  chatMessageRowPropsEqual,
} from './chat-message-row-props'

const message: UIMessage = {
  id: 'asst-1',
  role: 'assistant',
  parts: [{ type: 'text', text: 'hi' }],
}

function baseProps(
  overrides: Partial<ChatMessageRowProps> = {},
): ChatMessageRowProps {
  return {
    message,
    conversationId: 'conv-1',
    isLastMessage: true,
    isStreaming: false,
    liked: false,
    disliked: false,
    onClickLike: () => {},
    onClickDislike: () => {},
    onApprove: () => {},
    onDeny: () => {},
    onPromote: () => {},
    ...overrides,
  }
}

describe('chatMessageRowPropsEqual', () => {
  test('equal when message identity, flags, and handlers match', () => {
    const onApprove = () => {}
    const onDeny = () => {}
    const onPromote = async () => {}
    const onClickLike = () => {}
    const onClickDislike = () => {}
    const a = baseProps({
      onApprove,
      onDeny,
      onPromote,
      onClickLike,
      onClickDislike,
    })
    const b = baseProps({
      onApprove,
      onDeny,
      onPromote,
      onClickLike,
      onClickDislike,
    })
    expect(chatMessageRowPropsEqual(a, b)).toBe(true)
  })

  test('unequal when onApprove identity changes (multi-approve stale-handler bug)', () => {
    const prev = baseProps({ onApprove: () => {} })
    const next = baseProps({ onApprove: () => {} })
    expect(chatMessageRowPropsEqual(prev, next)).toBe(false)
  })

  test('unequal when onDeny identity changes', () => {
    const prev = baseProps({ onDeny: () => {} })
    const next = baseProps({ onDeny: () => {} })
    expect(chatMessageRowPropsEqual(prev, next)).toBe(false)
  })

  test('unequal when conversationId changes', () => {
    const prev = baseProps({ conversationId: 'conv-1' })
    const next = baseProps({ conversationId: 'conv-2' })
    expect(chatMessageRowPropsEqual(prev, next)).toBe(false)
  })
})
