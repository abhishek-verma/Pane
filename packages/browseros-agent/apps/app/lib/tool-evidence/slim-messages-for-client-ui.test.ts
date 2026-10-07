import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import { slimMessagesForClientUi } from './slim-messages-for-client-ui'

describe('slimMessagesForClientUi', () => {
  test('truncates fat tool text without marking spilled (no store on client)', () => {
    const fat = 'z'.repeat(10_000)
    const messages: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-navigate',
            toolCallId: 'c1',
            state: 'output-available',
            input: {},
            output: { content: [{ type: 'text', text: fat }] },
          } as never,
        ],
      },
    ]
    const next = slimMessagesForClientUi(messages, 100)
    expect(next).not.toBe(messages)
    const orig = (
      messages[0].parts[0] as { output: { content: Array<{ text: string }> } }
    ).output.content[0].text
    expect(orig.length).toBe(10_000)
    const out = (
      next[0].parts[0] as {
        output: {
          spilled?: boolean
          preview?: string
          content: Array<{ text: string }>
        }
      }
    ).output
    expect(out.spilled).not.toBe(true)
    expect(out.content[0].text.length).toBeLessThan(200)
    expect(out.preview?.length).toBeLessThan(200)
  })

  test('returns same reference for already-slim messages', () => {
    const messages: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-tabs',
            toolCallId: 'c1',
            state: 'output-available',
            input: {},
            output: { content: [{ type: 'text', text: 'ok' }] },
          } as never,
        ],
      },
    ]
    expect(slimMessagesForClientUi(messages)).toBe(messages)
  })

  test('strips image data without JSON.stringify of the payload', () => {
    const fat = 'i'.repeat(50_000)
    const messages: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'c1',
            state: 'output-available',
            input: {},
            output: {
              content: [
                { type: 'text', text: 'ok' },
                { type: 'image', data: fat, mimeType: 'image/jpeg' },
              ],
            },
          } as never,
        ],
      },
    ]
    const next = slimMessagesForClientUi(messages)
    const content = (
      next[0].parts[0] as {
        output: { content: Array<Record<string, unknown>> }
      }
    ).output.content
    expect(content[1]?.stripped).toBe(true)
    expect(content[1]?.data).toBeUndefined()
  })

  test('bounds oversized reasoning and exposes full-turn paging', () => {
    const fatReasoning = 'thinking '.repeat(2_000) // ~18,000 chars
    const messages: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: fatReasoning, state: 'done' } as never,
        ],
      },
    ]
    const next = slimMessagesForClientUi(messages, 100)
    expect(next === messages).toBe(false)
    const out = next[0].parts[0] as { text: string }
    expect(out.text.length).toBeLessThanOrEqual(16_000)
    expect(
      next[0].parts.some((part) => part.type === 'data-pane-content-preview'),
    ).toBe(true)
    // Original reference is never mutated.
    const orig = messages[0].parts[0] as { text: string }
    expect(orig.text.length).toBe(fatReasoning.length)
  })

  test('leaves a short reasoning part untouched', () => {
    const messages: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'short thought', state: 'done' } as never,
        ],
      },
    ]
    const next = slimMessagesForClientUi(messages, 100)
    expect(next).toBe(messages)
  })

  // Reasoning has its own resident-state limit; tool-preview limits must not
  // reintroduce the state-update loop formerly caused by truncation suffixes.
  test('is idempotent for reasoning parts across a range of previewMaxChars', () => {
    for (const previewMaxChars of [0, 1, 5, 13, 14, 100, 2000]) {
      const messages: UIMessage[] = [
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'reasoning',
              text: 'x'.repeat(5_000),
              state: 'done',
            } as never,
          ],
        },
      ]
      const once = slimMessagesForClientUi(messages, previewMaxChars)
      const twice = slimMessagesForClientUi(once, previewMaxChars)
      expect(twice).toBe(once)
      const text = (once[0]?.parts[0] as { text: string }).text
      expect(text).toBe('x'.repeat(5_000))
    }
  })

  // Same idempotency property for the tool-output truncation path — no
  // known bug here, but this is exactly the check that would have caught
  // the reasoning regression, so cover the sibling path too.
  test('is idempotent for oversized tool outputs', () => {
    const messages: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-navigate',
            toolCallId: 'c1',
            state: 'output-available',
            input: {},
            output: { content: [{ type: 'text', text: 'z'.repeat(50_000) }] },
          } as never,
        ],
      },
    ]
    const once = slimMessagesForClientUi(messages, 100)
    const twice = slimMessagesForClientUi(once, 100)
    expect(twice).toBe(once)
  })
})

for (const type of ['dynamic-tool', 'tool-notion']) {
  for (const output of [
    'document'.repeat(300_000),
    { structuredContent: { pages: [{ body: 'document'.repeat(300_000) }] } },
    {
      content: Array.from({ length: 1000 }, () => ({
        type: 'text',
        text: 'x'.repeat(3000),
      })),
    },
    { contentLength: 3_000_000, data: 'x'.repeat(3_000_000) },
  ]) {
    test(`bounds ${type} large results and preserves conversation content`, () => {
      const messages = [
        {
          id: 'user',
          role: 'user',
          parts: [{ type: 'text', text: 'Work on my Notion document' }],
        },
        {
          id: 'assistant',
          role: 'assistant',
          parts: [
            {
              type,
              toolName: 'notion',
              toolCallId: 'call',
              state: 'output-available',
              input: { page: '123' },
              output,
            },
            { type: 'text', text: 'Updated your document.' },
          ],
        },
      ] as UIMessage[]
      const next = slimMessagesForClientUi(messages)
      expect(JSON.stringify(next).length).toBeLessThan(10_000)
      expect(next.map((message) => message.id)).toEqual(['user', 'assistant'])
      expect(next[0]).toBe(messages[0])
      expect(next[1].parts[1]).toBe(messages[1].parts[1])
      expect((next[1].parts[0] as { input: unknown }).input).toEqual({
        page: '123',
      })
      expect((messages[1].parts[0] as { output: unknown }).output).toBe(output)
      expect(slimMessagesForClientUi(next)).toBe(next)
    })
  }
}
