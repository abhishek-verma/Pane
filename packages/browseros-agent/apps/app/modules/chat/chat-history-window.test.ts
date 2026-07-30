import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import { mergeOlderMessages, takeNewestPage } from './chat-history-window'

function msg(id: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text: id }] }
}

describe('chat-history-window', () => {
  test('takeNewestPage keeps the tail', () => {
    const all = [msg('1'), msg('2'), msg('3'), msg('4'), msg('5')]
    expect(takeNewestPage(all, 3).map((m) => m.id)).toEqual(['3', '4', '5'])
  })

  test('mergeOlderMessages prepends and caps while keeping tail', () => {
    const current = [msg('c'), msg('d'), msg('e'), msg('f')]
    const older = [msg('a'), msg('b')]
    const { messages, droppedNewest } = mergeOlderMessages({
      current,
      older,
      maxResident: 4,
      keepTail: 2,
    })
    expect(messages.map((m) => m.id)).toEqual(['a', 'b', 'e', 'f'])
    expect(droppedNewest).toBeGreaterThan(0)
  })

  test('mergeOlderMessages dedupes by id', () => {
    const current = [msg('b'), msg('c')]
    const older = [msg('a'), msg('b')]
    const { messages } = mergeOlderMessages({
      current,
      older,
      maxResident: 10,
    })
    expect(messages.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })
})
