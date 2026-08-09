import { describe, expect, it } from 'bun:test'
import { shouldResumeLastActiveConversation } from './shouldResumeLastActiveConversation'

describe('shouldResumeLastActiveConversation', () => {
  it('resumes when a stored id exists and no URL/query override is present', () => {
    expect(
      shouldResumeLastActiveConversation({
        origin: 'sidepanel',
        conversationIdParam: null,
        qParam: null,
        storedConversationId: 'conv-1',
      }),
    ).toBe(true)
  })

  it('does not resume on the newtab origin', () => {
    expect(
      shouldResumeLastActiveConversation({
        origin: 'newtab',
        conversationIdParam: null,
        qParam: null,
        storedConversationId: 'conv-1',
      }),
    ).toBe(false)
  })

  it('does not resume when the URL already carries a conversationId', () => {
    expect(
      shouldResumeLastActiveConversation({
        origin: 'sidepanel',
        conversationIdParam: 'conv-2',
        qParam: null,
        storedConversationId: 'conv-1',
      }),
    ).toBe(false)
  })

  it('does not resume when a home-composer handoff (?q=) is present', () => {
    expect(
      shouldResumeLastActiveConversation({
        origin: 'sidepanel',
        conversationIdParam: null,
        qParam: 'summarize this page',
        storedConversationId: 'conv-1',
      }),
    ).toBe(false)
  })

  it('does not resume when nothing was stored', () => {
    expect(
      shouldResumeLastActiveConversation({
        origin: 'sidepanel',
        conversationIdParam: null,
        qParam: null,
        storedConversationId: null,
      }),
    ).toBe(false)
  })
})
