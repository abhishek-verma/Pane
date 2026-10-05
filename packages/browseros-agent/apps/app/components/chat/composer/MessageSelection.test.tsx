import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageSelection } from './MessageSelection'

const message: UIMessage = {
  id: 'selected-message',
  role: 'user',
  parts: [{ type: 'text', text: 'Explain this' }],
  metadata: {
    composer: {
      selection: {
        text: 'A selected passage\nwith two lines.',
        pageTitle: 'Source article',
        pageUrl: 'https://example.com/article',
        tabId: 1,
        timestamp: 123,
      },
    },
  },
}

describe('sent message selection', () => {
  it('shows the saved selection and source after a history round trip', () => {
    const restored = JSON.parse(JSON.stringify(message)) as UIMessage
    const html = renderToStaticMarkup(<MessageSelection message={restored} />)
    expect(html).toContain('Selected text')
    expect(html).toContain('A selected passage\nwith two lines.')
    expect(html).toContain('Source article')
    expect(html).toContain('https://example.com/article')
    expect(html).not.toContain('<details')
  })

  it('keeps the full long selection available in an expandable quote', () => {
    const text = `${'Long selected passage. '.repeat(30)}Final sentence.`
    const html = renderToStaticMarkup(
      <MessageSelection
        message={{
          ...message,
          metadata: {
            composer: { selection: { text, pageUrl: 'https://example.com' } },
          },
        }}
      />,
    )
    expect(html).toContain('<details')
    expect(html).toContain('Show full selection')
    expect(html).toContain(text)
    expect(html).toContain('https://example.com')
  })

  it('does not add a card to messages without a selection or assistant replies', () => {
    for (const candidate of [
      { ...message, metadata: undefined },
      { ...message, metadata: { composer: { selection: null } } },
      { ...message, role: 'assistant' as const },
    ]) {
      expect(
        renderToStaticMarkup(<MessageSelection message={candidate} />),
      ).toBe('')
    }
  })
})
