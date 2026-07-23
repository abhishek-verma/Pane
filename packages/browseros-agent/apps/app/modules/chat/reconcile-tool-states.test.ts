import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  hasApprovalRespondedParts,
  hydrateClientMessagesFromServer,
  isCompleteAssistantTurn,
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

  test('upgrades stop-raced output-denied when server has output-available', () => {
    const client: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'call-1',
            state: 'output-denied',
            input: {},
            approval: {
              id: 'apr-1',
              approved: false,
              reason: 'Interrupted',
            },
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
            input: {},
            approval: { id: 'apr-1', approved: true },
            output: { content: [{ type: 'text', text: 'ok' }] },
          },
        ],
      },
    ]
    const next = reconcileClientToolStatesFromServer(client, server)
    expect((next[0]?.parts[0] as { state?: string }).state).toBe(
      'output-available',
    )
  })

  test('does not upgrade true denial when server is also output-denied', () => {
    const client: UIMessage[] = [
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

describe('isCompleteAssistantTurn', () => {
  test('requires settled tools plus text or a terminal tool', () => {
    expect(
      isCompleteAssistantTurn({
        id: 'a',
        role: 'assistant',
        parts: [{ type: 'text', text: 'done' }],
      }),
    ).toBe(true)
    expect(
      isCompleteAssistantTurn({
        id: 'a',
        role: 'assistant',
        parts: [
          {
            type: 'tool-filesystem_write',
            toolCallId: 'c1',
            state: 'output-available',
            input: {},
            output: 'ok',
          },
        ],
      }),
    ).toBe(true)
    expect(
      isCompleteAssistantTurn({
        id: 'a',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'c1',
            state: 'input-available',
            input: {},
          },
        ],
      }),
    ).toBe(false)
  })
})

describe('hydrateClientMessagesFromServer', () => {
  test('hydrates missing trailing text after tools (silent-reply shape)', () => {
    const client: UIMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'create file' }],
      },
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          { type: 'reasoning', text: 'writing', state: 'done' },
          {
            type: 'tool-filesystem_write',
            toolCallId: 'write-1',
            state: 'output-available',
            input: { path: 'Target-Profile.md' },
            output: { ok: true },
          },
        ],
      },
    ]
    const server: UIMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'create file' }],
      },
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          { type: 'reasoning', text: 'writing', state: 'done' },
          {
            type: 'tool-filesystem_write',
            toolCallId: 'write-1',
            state: 'output-available',
            input: { path: 'Target-Profile.md' },
            output: { ok: true },
          },
          { type: 'step-start' },
          { type: 'reasoning', text: 'done', state: 'done' },
          {
            type: 'text',
            text: 'Created Target-Profile.md',
            state: 'done',
          },
        ],
      },
    ]

    const result = hydrateClientMessagesFromServer(client, server)
    expect(result.hydratedAssistantTurn).toBe(true)
    const asst = result.messages.find((m) => m.id === 'asst-1')
    expect(asst?.parts?.some((p) => p.type === 'text')).toBe(true)
    expect(
      (asst?.parts?.find((p) => p.type === 'text') as { text?: string })?.text,
    ).toBe('Created Target-Profile.md')
  })

  test('appends a completed assistant turn the client never received', () => {
    const client: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    ]
    const server: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hello' }],
      },
    ]
    const result = hydrateClientMessagesFromServer(client, server)
    expect(result.hydratedAssistantTurn).toBe(true)
    expect(result.messages.map((m) => m.id)).toEqual(['u1', 'asst-1'])
  })

  test('still upgrades stuck approval-responded via reconcile', () => {
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
          { type: 'text', text: 'done' },
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
            input: {},
            approval: { id: 'apr-1', approved: true },
            output: { ok: true },
          },
          { type: 'text', text: 'done' },
        ],
      },
    ]
    const result = hydrateClientMessagesFromServer(client, server)
    expect((result.messages[0]?.parts[0] as { state?: string }).state).toBe(
      'output-available',
    )
  })

  test('no-op when client already matches the completed server turn', () => {
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-filesystem_write',
            toolCallId: 'w1',
            state: 'output-available',
            input: {},
            output: 'ok',
          },
          { type: 'text', text: 'Created file' },
        ],
      },
    ]
    const result = hydrateClientMessagesFromServer(messages, messages)
    expect(result.hydratedAssistantTurn).toBe(false)
    expect(result.messages).toBe(messages)
  })

  test('does not clobber pending approval-requested cards', () => {
    const client: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { kind: 'click', edited: true },
            approval: { id: 'apr-1' },
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
            input: { kind: 'click' },
            approval: { id: 'apr-1' },
          },
          { type: 'text', text: 'should not appear while pending' },
        ],
      },
    ]
    // Server turn is incomplete (still approval-requested) → no hydrate.
    const incompleteServer = hydrateClientMessagesFromServer(client, server)
    expect(incompleteServer.hydratedAssistantTurn).toBe(false)
    expect(
      (incompleteServer.messages[0]?.parts[0] as { input?: unknown }).input,
    ).toEqual({ kind: 'click', edited: true })

    // Server finished the tool, but the client still had a pending card
    // (possibly with edited args). Reconcile upgrades the tool state;
    // full message replace stays blocked so local edits are not dropped.
    const serverWithTerminalSibling: UIMessage[] = [
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
            output: 'ran',
          },
          {
            type: 'tool-act',
            toolCallId: 'call-2',
            state: 'output-available',
            input: {},
            output: 'other',
          },
          { type: 'text', text: 'done' },
        ],
      },
    ]
    const result = hydrateClientMessagesFromServer(
      client,
      serverWithTerminalSibling,
    )
    expect(result.hydratedAssistantTurn).toBe(false)
    expect((result.messages[0]?.parts[0] as { state?: string }).state).toBe(
      'output-available',
    )
    expect((result.messages[0]?.parts[0] as { input?: unknown }).input).toEqual(
      { kind: 'click' },
    )
    expect(result.messages[0]?.parts).toHaveLength(1)
  })

  test('stop-race output-denied still upgrades without regressing', () => {
    const client: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'call-1',
            state: 'output-denied',
            input: {},
            approval: {
              id: 'apr-1',
              approved: false,
              reason: 'Interrupted before approval',
            },
          },
          { type: 'text', text: 'interrupted' },
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
            input: {},
            approval: { id: 'apr-1', approved: true },
            output: { content: [{ type: 'text', text: 'ok' }] },
          },
          { type: 'text', text: 'interrupted' },
        ],
      },
    ]
    const result = hydrateClientMessagesFromServer(client, server)
    expect((result.messages[0]?.parts[0] as { state?: string }).state).toBe(
      'output-available',
    )
  })
})
