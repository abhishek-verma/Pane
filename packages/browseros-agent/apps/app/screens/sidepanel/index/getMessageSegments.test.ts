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
})
