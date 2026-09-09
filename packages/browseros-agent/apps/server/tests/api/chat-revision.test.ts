import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import { revisionPrefix } from '../../src/api/chat-revision'

describe('historical message revisions', () => {
  const source: UIMessage[] = [
    {
      id: 'first',
      role: 'user',
      parts: [
        { type: 'text', text: 'Read this file' },
        {
          type: 'file',
          mediaType: 'application/pdf',
          filename: 'brief.pdf',
          url: 'data:application/pdf;base64,JVBERi0=',
        },
      ],
    },
    {
      id: 'answer',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Earlier answer' }],
    },
    {
      id: 'edit',
      role: 'user',
      parts: [{ type: 'text', text: 'Original instruction' }],
    },
    {
      id: 'later',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Superseded answer' }],
    },
  ]
  it('uses only prior context, preserves files and leaves the original recoverable', () => {
    const prefix = revisionPrefix(source, 'edit')
    expect(prefix.map((message) => message.id)).toEqual(['first', 'answer'])
    expect(prefix[0].parts[1]).toMatchObject({
      type: 'file',
      filename: 'brief.pdf',
    })
    prefix[0].parts = []
    expect(source[0].parts).toHaveLength(2)
    expect(source).toHaveLength(4)
  })
  it('starts clean for a first-message revision', () =>
    expect(revisionPrefix(source, 'first')).toEqual([]))
  it('rejects an absent message and an assistant message instead of truncating arbitrary history', () => {
    expect(() => revisionPrefix(source, 'missing')).toThrow('not found')
    expect(() => revisionPrefix(source, 'answer')).toThrow('not found')
  })
})
