import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  applyToolApprovalDecisions,
  listPendingToolApprovals,
  settleUnresolvedToolApprovals,
} from '../../src/agent/tool-approval-resolve'

function pendingAssistant(): UIMessage {
  return {
    id: 'asst-1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-evaluate',
        toolCallId: 'call-1',
        state: 'approval-requested',
        input: { expression: 'document.title' },
        approval: { id: 'approval-1' },
      } as never,
    ],
  }
}

describe('tool-approval-resolve', () => {
  it('applyToolApprovalDecisions patches approval-requested parts', () => {
    const messages: UIMessage[] = [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      pendingAssistant(),
    ]
    const { patched, unmatched } = applyToolApprovalDecisions(messages, [
      {
        approvalId: 'approval-1',
        toolCallId: 'call-1',
        toolName: 'evaluate',
        approved: true,
        input: { expression: '1+1' },
      },
    ])
    expect(patched).toBe(1)
    expect(unmatched).toEqual([])
    const part = messages[1]?.parts[0] as {
      state?: string
      approval?: { approved?: boolean }
      input?: Record<string, unknown>
    }
    expect(part.state).toBe('approval-responded')
    expect(part.approval?.approved).toBe(true)
    expect(part.input).toEqual({ expression: '1+1' })
  })

  it('applyToolApprovalDecisions is idempotent and reports unmatched ids', () => {
    const messages: UIMessage[] = [pendingAssistant()]
    applyToolApprovalDecisions(messages, [
      {
        approvalId: 'approval-1',
        toolCallId: 'call-1',
        toolName: 'evaluate',
        approved: false,
      },
    ])
    const second = applyToolApprovalDecisions(messages, [
      {
        approvalId: 'approval-1',
        toolCallId: 'call-1',
        toolName: 'evaluate',
        approved: false,
      },
      {
        approvalId: 'missing',
        toolCallId: 'x',
        toolName: 'evaluate',
        approved: true,
      },
    ])
    expect(second.patched).toBe(0)
    expect(second.unmatched).toEqual(['missing'])
  })

  it('settleUnresolvedToolApprovals auto-denies pending approvals', () => {
    const messages: UIMessage[] = [pendingAssistant()]
    expect(listPendingToolApprovals(messages)).toHaveLength(1)
    expect(settleUnresolvedToolApprovals(messages)).toBe(1)
    expect(listPendingToolApprovals(messages)).toHaveLength(0)
    const part = messages[0]?.parts[0] as {
      state?: string
      approval?: { approved?: boolean; reason?: string }
    }
    expect(part.state).toBe('output-denied')
    expect(part.approval?.approved).toBe(false)
    expect(part.approval?.reason).toContain('Superseded')
  })
})
