import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  migrateLegacyToolStates,
  prepareMessagesForAgentTurn,
  settleIncompleteToolParts,
} from '../../src/agent/message-repair'

function asst(parts: unknown[], id = 'a1'): UIMessage {
  return { id, role: 'assistant', parts: parts as UIMessage['parts'] }
}

function user(text: string, id = 'u1'): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] }
}

describe('settleIncompleteToolParts', () => {
  it('maps input-available to output-error', () => {
    const messages: UIMessage[] = [
      asst([
        {
          type: 'tool-evaluate',
          toolCallId: 'c1',
          state: 'input-available',
          input: { expression: '1' },
        },
      ]),
    ]
    expect(settleIncompleteToolParts(messages, 'Aborted')).toBe(1)
    const part = messages[0]?.parts[0] as { state: string; errorText?: string }
    expect(part.state).toBe('output-error')
    expect(part.errorText).toContain('Aborted')
  })

  it('maps input-streaming to output-error', () => {
    const messages: UIMessage[] = [
      asst([
        {
          type: 'tool-act',
          toolCallId: 'c2',
          state: 'input-streaming',
          input: {},
        },
      ]),
    ]
    expect(settleIncompleteToolParts(messages)).toBe(1)
    expect((messages[0]?.parts[0] as { state: string }).state).toBe(
      'output-error',
    )
  })

  it('leaves terminal states alone', () => {
    const messages: UIMessage[] = [
      asst([
        {
          type: 'tool-evaluate',
          toolCallId: 'c1',
          state: 'output-available',
          input: {},
          output: { ok: true },
        },
      ]),
    ]
    expect(settleIncompleteToolParts(messages)).toBe(0)
  })

  it('ignores parts without a toolCallId', () => {
    const messages: UIMessage[] = [
      asst([{ type: 'tool-evaluate', state: 'input-available', input: {} }]),
    ]
    expect(settleIncompleteToolParts(messages)).toBe(0)
  })

  it('leaves user/text messages untouched', () => {
    const messages: UIMessage[] = [user('hi')]
    expect(settleIncompleteToolParts(messages)).toBe(0)
  })
})

describe('migrateLegacyToolStates', () => {
  it('rewrites state result to output-available', () => {
    const messages: UIMessage[] = [
      asst([
        {
          type: 'tool-evaluate',
          toolCallId: 'c1',
          state: 'result',
          input: {},
          output: { ok: true },
        },
      ]),
    ]
    expect(migrateLegacyToolStates(messages)).toBe(1)
    expect((messages[0]?.parts[0] as { state: string }).state).toBe(
      'output-available',
    )
  })

  it('rewrites state call to input-available', () => {
    const messages: UIMessage[] = [
      asst([
        {
          type: 'tool-evaluate',
          toolCallId: 'c1',
          state: 'call',
          input: {},
        },
      ]),
    ]
    expect(migrateLegacyToolStates(messages)).toBe(1)
    expect((messages[0]?.parts[0] as { state: string }).state).toBe(
      'input-available',
    )
  })

  it('rewrites state partial-call to input-streaming', () => {
    const messages: UIMessage[] = [
      asst([
        {
          type: 'tool-evaluate',
          toolCallId: 'c1',
          state: 'partial-call',
          input: {},
        },
      ]),
    ]
    expect(migrateLegacyToolStates(messages)).toBe(1)
    expect((messages[0]?.parts[0] as { state: string }).state).toBe(
      'input-streaming',
    )
  })

  it('leaves current-generation states alone', () => {
    const messages: UIMessage[] = [
      asst([
        {
          type: 'tool-evaluate',
          toolCallId: 'c1',
          state: 'output-available',
          input: {},
          output: {},
        },
      ]),
    ]
    expect(migrateLegacyToolStates(messages)).toBe(0)
  })
})

describe('prepareMessagesForAgentTurn', () => {
  it('migrates, repairs, and settles so validateUIMessages accepts the history', async () => {
    const { validateUIMessages } = await import('ai')
    const messages: UIMessage[] = [
      user('hi'),
      asst([
        {
          type: 'tool-evaluate',
          toolCallId: 'c1',
          state: 'result',
          input: { expression: '1' },
          output: { ok: true },
        },
        {
          type: 'tool-act',
          toolCallId: 'c2',
          state: 'input-available',
          input: { kind: 'click' },
        },
        {
          type: 'tool-evaluate',
          toolCallId: 'c3',
          state: 'approval-responded',
          input: { expression: '2' },
          approval: { id: 'ap3' },
        },
      ]),
    ]
    const result = prepareMessagesForAgentTurn(messages, {
      toolNames: new Set(['evaluate', 'act']),
      settleApprovals: true,
      settleIncomplete: true,
    })
    expect(result.migrated).toBe(1)
    expect(result.settledIncomplete).toBe(1)
    expect(result.repairedApprovals).toBe(1)
    expect(result.sanitizedCount).toBe(0)
    expect(result.changed).toBe(true)
    await validateUIMessages({ messages: result.messages })
  })

  it('drops tool parts for tools no longer in the toolset and reports the count', () => {
    const messages: UIMessage[] = [
      user('hi'),
      asst([
        {
          type: 'tool-removed_tool',
          toolCallId: 'c1',
          state: 'output-available',
          input: {},
          output: {},
        },
      ]),
    ]
    const result = prepareMessagesForAgentTurn(messages, {
      toolNames: new Set(['evaluate']),
    })
    // The assistant message becomes content-less once its only part is
    // stripped, so the whole message is dropped too.
    expect(result.sanitizedCount).toBe(1)
    expect(result.changed).toBe(true)
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.role).toBe('user')
  })

  it('is a no-op (changed=false) on an already-clean transcript', () => {
    const messages: UIMessage[] = [
      user('hi'),
      asst([{ type: 'text', text: 'hello' }]),
    ]
    const result = prepareMessagesForAgentTurn(messages, {
      toolNames: new Set(['evaluate']),
      settleApprovals: true,
      settleIncomplete: true,
    })
    expect(result.changed).toBe(false)
    expect(result.messages).toHaveLength(2)
  })

  it('does not settle approvals when settleApprovals is false (approval-resume path)', () => {
    const messages: UIMessage[] = [
      user('hi'),
      asst([
        {
          type: 'tool-evaluate',
          toolCallId: 'c1',
          state: 'approval-responded',
          input: {},
          approval: { id: 'ap1', approved: true },
        },
      ]),
    ]
    const result = prepareMessagesForAgentTurn(messages, {
      settleApprovals: false,
      settleIncomplete: true,
    })
    expect(result.settledApprovals).toBe(0)
    expect((result.messages[1]?.parts[0] as { state: string }).state).toBe(
      'approval-responded',
    )
  })
})
