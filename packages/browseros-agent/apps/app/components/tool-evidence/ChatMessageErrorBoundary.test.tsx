import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatMessageErrorBoundary } from './ChatMessageErrorBoundary'

describe('ChatMessageErrorBoundary', () => {
  test('renders children when nothing has thrown', () => {
    const html = renderToStaticMarkup(
      <ChatMessageErrorBoundary resetKey="a">
        <span>hello</span>
      </ChatMessageErrorBoundary>,
    )
    expect(html).toContain('hello')
  })

  test('getDerivedStateFromError captures the thrown error', () => {
    const error = new Error('boom')
    expect(ChatMessageErrorBoundary.getDerivedStateFromError(error)).toEqual({
      error,
    })
  })

  test('renders a fallback instead of the children once an error is caught', () => {
    const boundary = new ChatMessageErrorBoundary({
      resetKey: 'a',
      children: <span>hello</span>,
    })
    boundary.state = { error: new Error('boom') }

    const html = renderToStaticMarkup(boundary.render())
    expect(html).toContain('Couldn')
    expect(html).not.toContain('hello')
  })

  test('clears a caught error once resetKey changes', () => {
    const boundary = new ChatMessageErrorBoundary({
      resetKey: 'a',
      children: null,
    })
    boundary.state = { error: new Error('boom') }

    boundary.componentDidUpdate({ resetKey: 'a', children: null })
    expect(boundary.state.error).not.toBeNull()

    // biome-ignore lint/suspicious/noExplicitAny: exercising the class directly, not through React's reconciler
    ;(boundary as any).setState = (partial: { error: Error | null }) => {
      boundary.state = { ...boundary.state, ...partial }
    }
    boundary.componentDidUpdate({ resetKey: 'b', children: null })
    expect(boundary.state.error).toBeNull()
  })
})
