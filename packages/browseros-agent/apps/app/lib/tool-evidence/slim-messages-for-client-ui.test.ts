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

  test('truncates an oversized reasoning part', () => {
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
    expect(next).not.toBe(messages)
    const out = next[0].parts[0] as { text: string }
    expect(out.text.length).toBeLessThan(200)
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

  // Regression: an earlier reasoning-truncation implementation produced a
  // result whose length was always > previewMaxChars (a growing "[truncated
  // N chars]" suffix on top of a full-length slice), so re-running the slim
  // pass on its own output kept treating it as "changed" forever. Callers
  // call this from a useEffect that setMessages()s whenever the result
  // differs by reference from the input — a non-convergent transform there
  // is an infinite render loop in production (React error #185, shipped in
  // v0.47.0.74). Any transform this function applies must be idempotent:
  // running it twice must equal running it once, for every previewMaxChars,
  // including ones smaller than a truncation marker/suffix.
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
      expect(text.length).toBeLessThanOrEqual(previewMaxChars)
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
