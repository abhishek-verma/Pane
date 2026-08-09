import { describe, expect, it } from 'bun:test'
import { shouldApplySearchAction } from './searchActionDedup'

describe('shouldApplySearchAction', () => {
  it('applies a requestId seen for the first time', () => {
    expect(
      shouldApplySearchAction({
        requestId: 'req-1',
        lastAppliedRequestId: null,
      }),
    ).toBe(true)
  })

  it('suppresses a duplicate delivery of the same requestId', () => {
    expect(
      shouldApplySearchAction({
        requestId: 'req-1',
        lastAppliedRequestId: 'req-1',
      }),
    ).toBe(false)
  })

  it('applies a genuinely new requestId even with identical prior content', () => {
    expect(
      shouldApplySearchAction({
        requestId: 'req-2',
        lastAppliedRequestId: 'req-1',
      }),
    ).toBe(true)
  })
})
