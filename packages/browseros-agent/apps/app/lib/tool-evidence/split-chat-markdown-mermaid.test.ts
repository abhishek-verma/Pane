import { describe, expect, test } from 'bun:test'
import { splitChatMarkdownMermaid } from './split-chat-markdown-mermaid'

describe('splitChatMarkdownMermaid', () => {
  test('returns plain markdown when there is no mermaid fence', () => {
    expect(splitChatMarkdownMermaid('hello **world**')).toEqual([
      { type: 'markdown', text: 'hello **world**' },
    ])
  })

  test('extracts a mermaid fence between markdown', () => {
    const parts = splitChatMarkdownMermaid(
      'Before\n\n```mermaid\nflowchart TD\n  A-->B\n```\n\nAfter',
    )
    expect(parts).toEqual([
      { type: 'markdown', text: 'Before\n\n' },
      { type: 'mermaid', source: 'flowchart TD\n  A-->B' },
      { type: 'markdown', text: '\n\nAfter' },
    ])
  })

  test('handles multiple mermaid fences', () => {
    const parts = splitChatMarkdownMermaid(
      '```mermaid\ngraph LR\n  A-->B\n```\nmiddle\n```mermaid\ngraph TB\n  C-->D\n```',
    )
    expect(parts).toHaveLength(3)
    expect(parts[0]).toEqual({
      type: 'mermaid',
      source: 'graph LR\n  A-->B',
    })
    expect(parts[1]).toEqual({ type: 'markdown', text: '\nmiddle\n' })
    expect(parts[2]).toEqual({
      type: 'mermaid',
      source: 'graph TB\n  C-->D',
    })
  })

  test('skips empty mermaid fences', () => {
    expect(splitChatMarkdownMermaid('```mermaid\n\n```\nok')).toEqual([
      { type: 'markdown', text: '\nok' },
    ])
  })
})
