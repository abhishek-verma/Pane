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
})
