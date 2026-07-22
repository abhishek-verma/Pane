import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  prepareMessagesForClientTurn,
  settleIncompleteToolPartsInMessages,
} from './prepare-messages-for-turn'

describe('settleIncompleteToolPartsInMessages', () => {
  test('maps input-available to output-error', () => {
    const messages: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'call-1',
            state: 'input-available',
            input: { kind: 'click' },
          },
        ],
      },
    ]

    const settled = settleIncompleteToolPartsInMessages(messages, 'Stopped')
    const part = settled[0]?.parts[0] as { state?: string; errorText?: string }
    expect(part.state).toBe('output-error')
    expect(part.errorText).toBe('Stopped')
  })

  test('maps input-streaming to output-error', () => {
    const messages: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-evaluate',
            toolCallId: 'call-1',
            state: 'input-streaming',
            input: {},
          },
        ],
      },
    ]

    const settled = settleIncompleteToolPartsInMessages(messages)
    const part = settled[0]?.parts[0] as { state?: string }
    expect(part.state).toBe('output-error')
  })

  test('leaves terminal states untouched and returns the same reference', () => {
    const messages: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-evaluate',
            toolCallId: 'call-1',
            state: 'output-available',
            input: {},
            output: {},
          },
        ],
      },
    ]

    const settled = settleIncompleteToolPartsInMessages(messages)
    expect(settled).toBe(messages)
  })

  test('does not mutate the original message objects (immutable update)', () => {
    const original: UIMessage = {
      id: 'asst-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-act',
          toolCallId: 'call-1',
          state: 'input-available',
          input: {},
        },
      ],
    }
    const messages: UIMessage[] = [original]

    const settled = settleIncompleteToolPartsInMessages(messages)
    expect(settled).not.toBe(messages)
    expect(settled[0]).not.toBe(original)
    expect((original.parts[0] as { state?: string }).state).toBe(
      'input-available',
    )
  })
})

describe('prepareMessagesForClientTurn', () => {
  test('settles both incomplete tools and pending approvals by default', () => {
    const messages: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'call-1',
            state: 'input-available',
            input: {},
          },
          {
            type: 'tool-evaluate',
            toolCallId: 'call-2',
            state: 'approval-requested',
            input: {},
            approval: { id: 'approval-1' },
          },
        ],
      },
    ]

    const prepared = prepareMessagesForClientTurn(messages)
    const parts = prepared[0]?.parts as Array<{ state?: string }>
    expect(parts[0]?.state).toBe('output-error')
    expect(parts[1]?.state).toBe('output-denied')
  })

  test('settleApprovals: false leaves approval-responded parts alone (approval-resume path)', () => {
    const messages: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-evaluate',
            toolCallId: 'call-1',
            state: 'approval-responded',
            input: {},
            approval: { id: 'approval-1', approved: true },
          },
        ],
      },
    ]

    const prepared = prepareMessagesForClientTurn(messages, {
      settleApprovals: false,
    })
    const part = prepared[0]?.parts[0] as { state?: string }
    expect(part.state).toBe('approval-responded')
  })

  test('settleIncomplete: false leaves input-available parts alone', () => {
    const messages: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'call-1',
            state: 'input-available',
            input: {},
          },
        ],
      },
    ]

    const prepared = prepareMessagesForClientTurn(messages, {
      settleIncomplete: false,
    })
    const part = prepared[0]?.parts[0] as { state?: string }
    expect(part.state).toBe('input-available')
  })

  test('is a no-op returning the same reference on an already-clean transcript', () => {
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hello' }],
      },
    ]

    const prepared = prepareMessagesForClientTurn(messages)
    expect(prepared).toBe(messages)
  })
})
