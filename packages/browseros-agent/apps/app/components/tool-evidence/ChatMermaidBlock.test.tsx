import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ChatMermaidStreamdownRenderer,
  normalizeMermaidFenceCase,
} from './ChatMermaidBlock'

describe('normalizeMermaidFenceCase', () => {
  test('lowercases a capitalized fence language so it matches the renderer lookup', () => {
    // Streamdown's own renderer lookup is a plain `===` (verified against
    // its bundled source, no case-folding anywhere in that path) — without
    // this, ```Mermaid silently falls through to a plain code block instead
    // of the sandboxed diagram, since neither the custom renderer nor
    // Streamdown's own built-in Mermaid plugin match on `language !==
    // 'mermaid'` exactly.
    const input = 'before\n```Mermaid\nflowchart TD\n  A-->B\n```\nafter'
    expect(normalizeMermaidFenceCase(input)).toBe(
      'before\n```mermaid\nflowchart TD\n  A-->B\n```\nafter',
    )
  })

  test('handles any backtick/tilde run length and leading indentation, unlike a fixed 3-backtick regex', () => {
    const fourBackticks = '````MERMAID\nflowchart TD\n````'
    expect(normalizeMermaidFenceCase(fourBackticks)).toBe(
      '````mermaid\nflowchart TD\n````',
    )
    const tildeFence = '~~~Mermaid\nflowchart TD\n~~~'
    expect(normalizeMermaidFenceCase(tildeFence)).toBe(
      '~~~mermaid\nflowchart TD\n~~~',
    )
    const indented = '  ```MerMaid\n  flowchart TD\n  ```'
    expect(normalizeMermaidFenceCase(indented)).toBe(
      '  ```mermaid\n  flowchart TD\n  ```',
    )
  })

  test('leaves already-lowercase fences and unrelated text untouched', () => {
    const input =
      'hello **world**\n```mermaid\nflowchart TD\n```\n```js\nx\n```'
    expect(normalizeMermaidFenceCase(input)).toBe(input)
  })
})

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
