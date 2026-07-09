import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import { collectToolApprovalResponses } from './collect-tool-approval-responses'

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
