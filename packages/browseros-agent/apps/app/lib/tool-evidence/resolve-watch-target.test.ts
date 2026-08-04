import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  buildScreencastWsUrl,
  httpToWsBase,
  resolveWatchPageId,
  shouldEnableLiveWatch,
} from './resolve-watch-target'

describe('resolveWatchPageId', () => {
  it('returns the newest browser tool page id', () => {
    const messages = [
      {
        id: '1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'a',
            state: 'output-available',
            input: { page: 3 },
          },
        ],
      },
      {
        id: '2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-navigate',
            toolCallId: 'b',
            state: 'input-available',
            input: { page: 7, url: 'https://example.com' },
          },
        ],
      },
    ] as unknown as UIMessage[]

    expect(resolveWatchPageId(messages)).toBe(7)
  })

  it('skips non-browser tools and invalid pages', () => {
    const messages = [
      {
        id: '1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-filesystem_edit',
            toolCallId: 'a',
            state: 'output-available',
            input: { page: 9, path: 'x.ts' },
          },
          {
            type: 'tool-act',
            toolCallId: 'b',
            state: 'output-available',
            input: { page: 0 },
          },
        ],
      },
    ] as unknown as UIMessage[]

    expect(resolveWatchPageId(messages)).toBeUndefined()
  })

  it('recognizes an ACP-namespaced browser tool (mcp__browseros__ prefix)', () => {
    const messages = [
      {
        id: '1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__browseros__navigate',
            toolCallId: 'a',
            state: 'output-available',
            input: { page: 4, url: 'https://example.com' },
          },
        ],
      },
    ] as unknown as UIMessage[]

    expect(resolveWatchPageId(messages)).toBe(4)
  })
})

describe('shouldEnableLiveWatch', () => {
  it('is false when not streaming', () => {
    const messages = [
      {
        id: '1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'a',
            state: 'output-available',
            input: { page: 3 },
          },
        ],
      },
    ] as unknown as UIMessage[]
    expect(shouldEnableLiveWatch(messages, false)).toBe(false)
  })

  it('is false while streaming without browser tools', () => {
    const messages = [
      {
        id: '1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'thinking…' }],
      },
    ] as unknown as UIMessage[]
    expect(shouldEnableLiveWatch(messages, true)).toBe(false)
  })

  it('is true while streaming with a browser tool on the newest assistant', () => {
    const messages = [
      {
        id: '1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-navigate',
            toolCallId: 'a',
            state: 'input-available',
            input: { page: 2, url: 'https://example.com' },
          },
        ],
      },
    ] as unknown as UIMessage[]
    expect(shouldEnableLiveWatch(messages, true)).toBe(true)
  })

  it('is true for an ACP-namespaced browser tool (mcp__browseros__ prefix)', () => {
    const messages = [
      {
        id: '1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__browseros__act',
            toolCallId: 'a',
            state: 'input-available',
            input: { page: 2 },
          },
        ],
      },
    ] as unknown as UIMessage[]
    expect(shouldEnableLiveWatch(messages, true)).toBe(true)
  })
})

describe('buildScreencastWsUrl', () => {
  it('builds ws url with windowId and optional pageId', () => {
    expect(httpToWsBase('http://127.0.0.1:9100')).toBe('ws://127.0.0.1:9100')
    expect(buildScreencastWsUrl('http://127.0.0.1:9100', 2)).toBe(
      'ws://127.0.0.1:9100/screencast?windowId=2',
    )
    expect(buildScreencastWsUrl('http://127.0.0.1:9100/', 2, 5)).toBe(
      'ws://127.0.0.1:9100/screencast?windowId=2&pageId=5',
    )
  })
})
