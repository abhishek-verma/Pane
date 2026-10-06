import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import type { UIMessage } from 'ai'

// slim-messages-to-fixed-point -> @/lib/sentry/sentry -> telemetryStorage ->
// @wxt-dev/storage (needs browser.runtime, unavailable under bun test).
// Mock the leaf import (matches lib/sentry/sentry.test.ts) so the real
// sentry module still loads — mocking @/lib/sentry/sentry itself would
// shadow it process-wide for every other test file that imports it.
mock.module('@wxt-dev/storage', () => ({
  storage: { defineItem: mock().mockReturnValue({ getValue: mock() }) },
}))

const { sentry } = await import('@/lib/sentry/sentry')
const { slimMessagesToFixedPoint } = await import(
  './slim-messages-to-fixed-point'
)

const messages: UIMessage[] = [{ id: 'a1', role: 'user', parts: [] }]

describe('slimMessagesToFixedPoint', () => {
  const captureException = spyOn(sentry, 'captureException').mockImplementation(
    () => '' as never,
  )

  beforeEach(() => {
    captureException.mockClear()
  })

  test('returns the original reference when already stable', () => {
    const applyOnce = (msgs: UIMessage[]) => msgs
    expect(slimMessagesToFixedPoint(messages, applyOnce)).toBe(messages)
    expect(captureException).not.toHaveBeenCalled()
  })

  test('settles within a few self-applications without extra renders', () => {
    // Simulates a transform that needs 3 passes to reach a fixed point
    // (e.g. a shrinking suffix whose own length changes each pass).
    let calls = 0
    const applyOnce = (msgs: UIMessage[]) => {
      calls++
      if (calls >= 3) return msgs
      return [...msgs]
    }
    const result = slimMessagesToFixedPoint(messages, applyOnce)
    expect(calls).toBe(3)
    expect(result).not.toBe(messages)
    expect(captureException).not.toHaveBeenCalled()
  })

  test('caps a non-convergent transform, reports it, and freezes at the original reference', () => {
    let calls = 0
    // Never returns the same reference twice — the failure mode this guards.
    const applyOnce = (msgs: UIMessage[]) => {
      calls++
      return [...msgs]
    }
    const result = slimMessagesToFixedPoint(messages, applyOnce)
    expect(calls).toBe(8)
    // Returning the original reference (not the still-diverging best-effort
    // result) is what actually stops the caller's setMessages loop — a
    // changed-but-not-converged result would still differ from `messages`
    // and still trigger another setMessages call next render.
    expect(result).toBe(messages)
    expect(captureException).toHaveBeenCalledTimes(1)
  })
})

// This is the same pipeline used by restoreFromServer before setMessages.
for (const type of ['tool-notion', 'dynamic-tool']) {
  test(`restores a 3 MB ${type} input without losing the chat or retaining the payload`, () => {
    const body = 'x'.repeat(3_000_000)
    const restored = [
      {
        id: 'question',
        role: 'user',
        parts: [{ type: 'text', text: 'Update my document' }],
      },
      {
        id: 'reply',
        role: 'assistant',
        metadata: { conversationId: 'existing-chat' },
        parts: [
          { type: 'text', text: 'Working on your document.' },
          {
            type,
            toolName: 'notion',
            toolCallId: 'call',
            state: 'approval-requested',
            approval: { id: 'approval' },
            input: { body },
          },
          { type: 'text', text: 'Your conversation remains available.' },
        ],
      },
    ] as UIMessage[]
    const next = slimMessagesToFixedPoint(restored)
    expect(JSON.stringify(next).length).toBeLessThan(1_000_000)
    expect(next.map((message) => message.id)).toEqual(['question', 'reply'])
    expect(next[0]).toBe(restored[0])
    expect(next[1].metadata).toEqual({ conversationId: 'existing-chat' })
    expect(next[1].parts[0]).toBe(restored[1].parts[0])
    expect(next[1].parts[2]).toBe(restored[1].parts[2])
    // Never turn a truncated argument preview into an approvable tool call.
    expect(next[1].parts[1].type).toBe('text')
    expect(
      (restored[1].parts[1] as { input: { body: string } }).input.body,
    ).toBe(body)
    expect(slimMessagesToFixedPoint(next)).toBe(next)
  })
}

test('restore bounds oversized metadata, provider fields, and aggregate tool inputs', () => {
  const restored = Array.from({ length: 30 }, (_, index) => ({
    id: `message-${index}`,
    role: 'assistant',
    metadata: { raw: 'x'.repeat(3_000_000) },
    parts: [
      {
        type: 'text',
        text: 'Saved visible reply',
        providerMetadata: { raw: 'x'.repeat(3_000_000) },
      },
      ...Array.from({ length: 200 }, () => ({
        type: 'tool-notion',
        toolCallId: 'call',
        state: 'output-available',
        input: { body: 'x'.repeat(5000) },
        output: {},
      })),
      { type: 'text', text: 'Final visible reply after tool work.' },
    ],
  })) as UIMessage[]
  const next = slimMessagesToFixedPoint(restored)
  expect(next.map((message) => message.id)).toEqual(
    restored.map((message) => message.id),
  )
  expect(JSON.stringify(next).length).toBeLessThan(1_000_000)
  expect(
    next[0].parts.some(
      (part) =>
        part.type === 'text' &&
        part.text === 'Final visible reply after tool work.',
    ),
  ).toBe(true)
  expect(slimMessagesToFixedPoint(next)).toBe(next)
})
