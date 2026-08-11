import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatMermaidStreamdownRenderer } from './ChatMermaidBlock'

describe('ChatMermaidStreamdownRenderer', () => {
  test('shows the streaming placeholder without touching the sandbox while incomplete', () => {
    const html = renderToStaticMarkup(
      <ChatMermaidStreamdownRenderer
        code="flowchart TD\n  A-->"
        isIncomplete={true}
        language="mermaid"
      />,
    )
    expect(html).toContain('Rendering diagram')
    // The incomplete-fence placeholder is its own static div, not
    // ChatMermaidBlock's (which is distinguishable by overflow-x-auto).
    expect(html).not.toContain('overflow-x-auto')
  })

  test('delegates to the sandboxed ChatMermaidBlock once the fence is complete', () => {
    const html = renderToStaticMarkup(
      <ChatMermaidStreamdownRenderer
        code="flowchart TD\n  A-->B"
        isIncomplete={false}
        language="mermaid"
      />,
    )
    expect(html).toContain('overflow-x-auto')
  })
})
