import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  excludeInFlightUserMessage,
  formatConversationHistory,
} from './formatConversationHistory'

function user(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] }
}

function assistant(id: string, text: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text }] }
}

describe('excludeInFlightUserMessage', () => {
  test('drops the trailing user when it matches the in-flight send text', () => {
    const messages = [
      user('u0', 'earlier'),
      assistant('a0', 'reply'),
      user('u1', 'new prompt'),
    ]
    expect(excludeInFlightUserMessage(messages, 'new prompt')).toEqual([
      user('u0', 'earlier'),
      assistant('a0', 'reply'),
    ])
  })

  test('keeps the trailing user when text does not match', () => {
    const messages = [user('u0', 'kept')]
    expect(excludeInFlightUserMessage(messages, 'other')).toEqual(messages)
  })

  test('no-op when the last message is not a user', () => {
    const messages = [user('u0', 'hi'), assistant('a0', 'yo')]
    expect(excludeInFlightUserMessage(messages, 'yo')).toEqual(messages)
  })

  test('first-turn send with only the in-flight user yields empty prior', () => {
    const messages = [user('u0', 'hello')]
    expect(excludeInFlightUserMessage(messages, 'hello')).toEqual([])
    expect(formatConversationHistory([])).toEqual([])
  })
})

describe('formatConversationHistory', () => {
  test('maps prior turns to role/content pairs', () => {
    expect(
      formatConversationHistory([
        user('u0', 'earlier'),
        assistant('a0', 'reply'),
      ]),
    ).toEqual([
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'reply' },
    ])
  })
})
