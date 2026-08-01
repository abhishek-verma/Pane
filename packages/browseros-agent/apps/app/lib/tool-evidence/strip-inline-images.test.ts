import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  estimateUiMessagesBytes,
  stripFatInlineImagesFromMessages,
} from './strip-inline-images'

function makeMsg(data: string): UIMessage {
  return {
    id: 'a1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-act',
        toolCallId: 'c1',
        toolName: 'act',
        state: 'result',
        input: {},
        output: {
          content: [{ type: 'image', data, mimeType: 'image/png' }],
          isError: false,
        },
      } as unknown as UIMessage['parts'][number],
    ],
  }
}

describe('stripFatInlineImagesFromMessages', () => {
  test('strips inline data larger than threshold', () => {
    const fat = 'A'.repeat(100_001)
    const messages = [makeMsg(fat)]
    const next = stripFatInlineImagesFromMessages(messages)
    expect(next).not.toBe(messages)
    const part = next[0]?.parts[0] as Record<string, unknown>
    const content = (part.output as Record<string, unknown>).content as Array<
      Record<string, unknown>
    >
    expect(content[0]?.stripped).toBe(true)
    expect(content[0]?.data).toBeUndefined()
  })

  test('strips all inline image data by default', () => {
    const messages = [makeMsg('small')]
    const next = stripFatInlineImagesFromMessages(messages)
    expect(next).not.toBe(messages)
    const part = next[0]?.parts[0] as Record<string, unknown>
    const content = (part.output as Record<string, unknown>).content as Array<
      Record<string, unknown>
    >
    expect(content[0]?.stripped).toBe(true)
    expect(content[0]?.data).toBeUndefined()
  })

  test('estimateUiMessagesBytes grows with content without requiring stringify of fat images', () => {
    const small = estimateUiMessagesBytes([makeMsg('x')])
    const large = estimateUiMessagesBytes([makeMsg('y'.repeat(10_000))])
    expect(large).toBeGreaterThan(small)
  })

  test('drops legacy structuredContent.image duplicates', () => {
    const messages: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-screenshot',
            toolCallId: 'c1',
            toolName: 'screenshot',
            state: 'result',
            input: {},
            output: {
              content: [{ type: 'text', text: 'ok' }],
              structuredContent: {
                image: 'A'.repeat(100_001),
                page: 1,
              },
              isError: false,
            },
          } as unknown as UIMessage['parts'][number],
        ],
      },
    ]
    const next = stripFatInlineImagesFromMessages(messages)
    const part = next[0]?.parts[0] as Record<string, unknown>
    const output = part.output as Record<string, unknown>
    const structured = output.structuredContent as Record<string, unknown>
    expect(structured.image).toBeUndefined()
    expect(structured.page).toBe(1)
  })
})
