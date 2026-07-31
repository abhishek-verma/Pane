import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import { getMessageSegments } from './getMessageSegments'

function assistantMessage(parts: UIMessage['parts'], id = 'msg-1'): UIMessage {
  return { id, role: 'assistant', parts }
}

describe('getMessageSegments', () => {
  test('skips duplicate resume reasoning and keeps one tool batch', () => {
    const reasoning =
      'The user wants me to create a new text file named test 2 with content abc.'
    const message = assistantMessage([
      { type: 'reasoning', text: reasoning },
      {
        type: 'tool-filesystem_write',
        toolCallId: 'call-1',
        state: 'approval-requested',
        input: { path: 'test 2', content: 'abc' },
        approval: { id: 'approval-1' },
      },
      { type: 'reasoning', text: reasoning },
      {
        type: 'tool-filesystem_write',
        toolCallId: 'call-1',
        state: 'output-available',
        input: { path: 'test 2', content: 'abc' },
        output: [{ type: 'text', text: 'ok' }],
        approval: { id: 'approval-1', approved: true },
      },
    ])

    const segments = getMessageSegments(message, true, false)

    expect(segments.filter((s) => s.type === 'reasoning')).toHaveLength(1)
    expect(segments.filter((s) => s.type === 'tool-batch')).toHaveLength(1)
    const batch = segments.find((s) => s.type === 'tool-batch')
    expect(batch?.type === 'tool-batch' && batch.tools).toHaveLength(1)
    if (batch?.type === 'tool-batch') {
      expect(batch.tools[0]?.state).toBe('output-available')
    }
  })

  test('emits pi-preview from pi_open tool output and autoOpen', () => {
    const message = assistantMessage([
      {
        type: 'tool-pi_open',
        toolCallId: 'call-pi',
        state: 'output-available',
        input: { href: 'pi://sites/s1' },
        output: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'pi_page',
                href: 'pi://sites/s1',
                navigate: true,
                preview: { title: 'Job Search', kind: 'site' },
              }),
            },
          ],
        },
      },
    ])

    const segments = getMessageSegments(message, true, false)
    const cards = segments.filter((s) => s.type === 'pi-preview')
    expect(cards).toHaveLength(1)
    if (cards[0]?.type === 'pi-preview') {
      expect(cards[0].href).toBe('pi://sites/s1')
      expect(cards[0].autoOpen).toBe(true)
      expect(cards[0].preview?.title).toBe('Job Search')
    }
    expect(segments.filter((s) => s.type === 'tool-batch')).toHaveLength(0)
  })

  test('splits pi:// links out of assistant text', () => {
    const message = assistantMessage([
      {
        type: 'text',
        text: 'Ready at pi://sites/abc/pages/p1 for you.',
      },
    ])
    const segments = getMessageSegments(message, true, false)
    expect(segments.some((s) => s.type === 'pi-preview')).toBe(true)
    const card = segments.find((s) => s.type === 'pi-preview')
    if (card?.type === 'pi-preview') {
      expect(card.href).toBe('pi://sites/abc/pages/p1')
    }
  })
})
