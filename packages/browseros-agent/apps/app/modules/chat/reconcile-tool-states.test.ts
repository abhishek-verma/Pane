import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  hasApprovalRespondedParts,
  reconcileClientToolStatesFromServer,
} from './reconcile-tool-states'

describe('reconcileClientToolStatesFromServer', () => {
  test('upgrades stuck approval-responded parts from server terminal state', () => {
    const client: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'call-1',
            state: 'approval-responded',
            input: { kind: 'click' },
            approval: { id: 'apr-1', approved: true },
          },
        ],
      },
    ]
    const server: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'call-1',
            state: 'output-available',
            input: { kind: 'click' },
            approval: { id: 'apr-1', approved: true },
            output: { content: [{ type: 'text', text: 'ok (click)' }] },
          },
        ],
      },
    ]

    const next = reconcileClientToolStatesFromServer(client, server)
    const part = next[0]?.parts[0] as {
      state?: string
      output?: unknown
    }
    expect(part.state).toBe('output-available')
    expect(part.output).toEqual({
      content: [{ type: 'text', text: 'ok (click)' }],
    })
  })

  test('leaves client alone when server has no terminal match', () => {
    const client: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'call-1',
            state: 'approval-responded',
            input: {},
            approval: { id: 'apr-1', approved: true },
          },
        ],
      },
    ]
    const server: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: {},
            approval: { id: 'apr-1' },
          },
        ],
      },
    ]

    expect(reconcileClientToolStatesFromServer(client, server)).toBe(client)
  })

  test('does not overwrite a client terminal state', () => {
    const client: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'call-1',
            state: 'output-available',
            input: {},
            output: 'client-won',
          },
        ],
      },
    ]
    const server: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'call-1',
            state: 'output-denied',
            input: {},
            approval: { id: 'apr-1', approved: false },
          },
        ],
      },
    ]

    expect(reconcileClientToolStatesFromServer(client, server)).toBe(client)
  })
})

describe('hasApprovalRespondedParts', () => {
  test('detects approval-responded parts', () => {
    expect(
      hasApprovalRespondedParts([
        {
          id: 'a',
          role: 'assistant',
          parts: [
            {
              type: 'tool-act',
              toolCallId: 'c1',
              state: 'approval-responded',
              input: {},
              approval: { id: 'apr', approved: true },
            },
          ],
        },
      ]),
    ).toBe(true)
  })

  test('returns false when none are stuck', () => {
    expect(
      hasApprovalRespondedParts([
        {
          id: 'a',
          role: 'assistant',
          parts: [
            {
              type: 'tool-act',
              toolCallId: 'c1',
              state: 'output-available',
              input: {},
              output: 'ok',
            },
          ],
        },
      ]),
    ).toBe(false)
  })
})
