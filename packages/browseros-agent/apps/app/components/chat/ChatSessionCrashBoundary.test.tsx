import { describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

// Mock the leaf (@wxt-dev/storage), matching lastActiveConversationStorage's
// own test — mocking @/lib/browseros/lastActiveConversationStorage directly
// would shadow it process-wide for every other test file that imports it.
mock.module('@wxt-dev/storage', () => ({
  storage: {
    getItem: async () => null,
    setItem: async () => {},
  },
}))

const { ChatSessionCrashBoundary } = await import('./ChatSessionCrashBoundary')

describe('ChatSessionCrashBoundary', () => {
  test('renders children when nothing has thrown', () => {
    const html = renderToStaticMarkup(
      <ChatSessionCrashBoundary>
        <span>hello</span>
      </ChatSessionCrashBoundary>,
    )
    expect(html).toContain('hello')
  })

  test('getDerivedStateFromError captures the thrown error', () => {
    const error = new Error('boom')
    expect(ChatSessionCrashBoundary.getDerivedStateFromError(error)).toEqual({
      error,
    })
  })

  test('renders a recoverable fallback instead of unmounting once an error is caught', () => {
    const boundary = new ChatSessionCrashBoundary({
      children: <span>hello</span>,
    })
    boundary.state = { error: new Error('boom') }

    const html = renderToStaticMarkup(boundary.render())
    expect(html).toContain('Reload chat')
    expect(html).not.toContain('hello')
  })
})
