import { describe, expect, it } from 'bun:test'
import {
  isSearchActionForReceiver,
  shouldApplySearchAction,
} from './searchActionDedup'

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

describe('sidepanel handoff targeting', () => {
  const action = { targetTabId: 1, targetWindowId: 10 }
  it('does not redirect other chats in the profile', () => {
    expect(
      isSearchActionForReceiver(action, {
        tabId: 2,
        windowId: 10,
        perWindow: false,
      }),
    ).toBe(false)
    expect(
      isSearchActionForReceiver(action, {
        tabId: 1,
        windowId: 20,
        perWindow: true,
      }),
    ).toBe(false)
    expect(
      isSearchActionForReceiver(
        {},
        { tabId: 1, windowId: 10, perWindow: false },
      ),
    ).toBe(false)
  })
  it('allows only the requested tab or its window-scoped panel', () => {
    expect(
      isSearchActionForReceiver(action, {
        tabId: 1,
        windowId: 10,
        perWindow: false,
      }),
    ).toBe(true)
    expect(
      isSearchActionForReceiver(action, {
        tabId: 2,
        windowId: 10,
        perWindow: true,
      }),
    ).toBe(true)
  })
})
