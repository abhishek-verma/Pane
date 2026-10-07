import { describe, expect, test } from 'bun:test'
import { boundUiTranscript } from '@browseros/shared/ui-transcript-window'
import type { UIMessage } from 'ai'
import { slimMessagesForClientUi } from '../../lib/tool-evidence/slim-messages-for-client-ui'
import { mergeOlderMessages, takeNewestPage } from './chat-history-window'
import { prepareMessagesForClientTurn } from './prepare-messages-for-turn'

function msg(id: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text: id }] }
}

describe('chat-history-window', () => {
  test('older pages remain visible through projection beyond 60 resident messages', () => {
    const history = Array.from({ length: 150 }, (_, index) =>
      msg(String(index)),
    )
    let current = history.slice(-60)

    // Follow the loadOlderMessages pipeline and ChatMessages render bound.
    for (const oldestIndex of [60, 30, 0]) {
      const older = history.slice(oldestIndex, oldestIndex + 30)
      const merged = mergeOlderMessages({ current, older, keepTail: 2 })
      current = boundUiTranscript(
        prepareMessagesForClientTurn(slimMessagesForClientUi(merged.messages), {
          settleApprovals: false,
        }),
      )

      expect(current).toHaveLength(60)
      expect(current[0].id).toBe(String(oldestIndex))
      expect(current.slice(0, 30).map((message) => message.id)).toEqual(
        older.map((message) => message.id),
      )
      expect(current.slice(-2).map((message) => message.id)).toEqual([
        '148',
        '149',
      ])
    }
  })

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
