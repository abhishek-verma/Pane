import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  collectToolApprovalResponses,
  hasPendingToolApprovals,
  hasPendingToolApprovalsExcluding,
  settleApprovalRequestedOnlyInMessages,
  settleUnresolvedToolApprovalsInMessages,
} from './collect-tool-approval-responses'

describe('collectToolApprovalResponses', () => {
  test('collects only from the latest assistant message', () => {
    const messages: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-filesystem_write',
            toolCallId: 'call-old',
            state: 'approval-responded',
            input: { path: 'old.txt', content: 'x' },
            approval: { id: 'approval-old', approved: true },
          },
        ],
      },
      {
        id: 'user-2',
        role: 'user',
        parts: [{ type: 'text', text: 'list all files in the workspace' }],
      },
    ]

    expect(collectToolApprovalResponses(messages)).toEqual([])
  })

  test('collects pending approvals from the current assistant turn', () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'write hello.txt' }],
      },
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-filesystem_write',
            toolCallId: 'call-1',
            state: 'approval-responded',
            input: { path: 'hello.txt', content: 'hi' },
            approval: { id: 'approval-1', approved: true },
          },
        ],
      },
    ]

    expect(collectToolApprovalResponses(messages)).toEqual([
      {
        approvalId: 'approval-1',
        toolCallId: 'call-1',
        toolName: 'filesystem_write',
        approved: true,
        input: { path: 'hello.txt', content: 'hi' },
      },
    ])
  })
})

describe('hasPendingToolApprovalsExcluding', () => {
  const twoPending: UIMessage[] = [
    {
      id: 'asst-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-filesystem_write',
          toolCallId: 'call-a',
          state: 'approval-requested',
          input: { path: 'a.txt' },
          approval: { id: 'approval-a' },
        },
        {
          type: 'tool-filesystem_write',
          toolCallId: 'call-b',
          state: 'approval-requested',
          input: { path: 'b.txt' },
          approval: { id: 'approval-b' },
        },
      ],
    },
  ]

  test('reports siblings still pending when excluding the card being answered', () => {
    expect(hasPendingToolApprovalsExcluding(twoPending, 'call-a')).toBe(true)
    expect(hasPendingToolApprovalsExcluding(twoPending, 'call-b')).toBe(true)
  })

  test('false when the excluded id is the only remaining pending approval', () => {
    const oneLeft: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-filesystem_write',
            toolCallId: 'call-a',
            state: 'approval-responded',
            input: { path: 'a.txt' },
            approval: { id: 'approval-a', approved: true },
          },
          {
            type: 'tool-filesystem_write',
            toolCallId: 'call-b',
            state: 'approval-requested',
            input: { path: 'b.txt' },
            approval: { id: 'approval-b' },
          },
        ],
      },
    ]
    expect(hasPendingToolApprovalsExcluding(oneLeft, 'call-b')).toBe(false)
    expect(hasPendingToolApprovalsExcluding(oneLeft, 'call-a')).toBe(true)
  })
})

describe('settleUnresolvedToolApprovalsInMessages', () => {
  test('auto-denies approval-requested parts when a new user turn supersedes them', () => {
    const messages: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-evaluate',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { expression: 'document.title' },
            approval: { id: 'approval-1' },
          },
        ],
      },
    ]

    expect(hasPendingToolApprovals(messages)).toBe(true)
    const settled = settleUnresolvedToolApprovalsInMessages(messages)
    expect(hasPendingToolApprovals(settled)).toBe(false)
    const part = settled[0]?.parts[0] as {
      state?: string
      approval?: { approved?: boolean; reason?: string }
    }
    expect(part.state).toBe('output-denied')
    expect(part.approval?.approved).toBe(false)
    expect(part.approval?.reason).toContain('Superseded')
  })

  test('also settles approval-responded orphans left by an aborted resume', () => {
    const messages: UIMessage[] = [
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-evaluate',
            toolCallId: 'call-1',
            state: 'approval-responded',
            input: { expression: '1' },
            approval: { id: 'approval-1', approved: true },
          },
        ],
      },
    ]

    const settled = settleUnresolvedToolApprovalsInMessages(messages)
    const part = settled[0]?.parts[0] as {
      state?: string
      approval?: { approved?: boolean }
    }
    expect(part.state).toBe('output-denied')
    expect(part.approval?.approved).toBe(false)
  })
})

describe('settleApprovalRequestedOnlyInMessages', () => {
  test('settles approval-requested but leaves approval-responded alone', () => {
    const messages: UIMessage[] = [
      {
        id: 'a',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'c1',
            state: 'approval-requested',
            input: {},
            approval: { id: 'apr-1' },
          },
          {
            type: 'tool-act',
            toolCallId: 'c2',
            state: 'approval-responded',
            input: {},
            approval: { id: 'apr-2', approved: true },
          },
        ],
      },
    ]
    const next = settleApprovalRequestedOnlyInMessages(messages, 'Stopped')
    const parts = next[0]?.parts as Array<{
      state?: string
      approval?: { approved?: boolean; reason?: string }
    }>
    expect(parts[0]?.state).toBe('output-denied')
    expect(parts[0]?.approval?.reason).toBe('Stopped')
    expect(parts[1]?.state).toBe('approval-responded')
    expect(parts[1]?.approval?.approved).toBe(true)
  })
})
