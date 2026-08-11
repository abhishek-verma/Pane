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
