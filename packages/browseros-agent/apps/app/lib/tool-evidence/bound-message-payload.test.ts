import { describe, expect, test } from 'bun:test'
import {
  contentPreview,
  UI_MESSAGE_PARTS,
  UI_TRANSCRIPT_BYTES,
} from '@browseros/shared/ui-transcript-window'
import type { UIMessage } from 'ai'
import { boundMessagePayload } from './bound-message-payload'
import { slimMessagesForClientUi } from './slim-messages-for-client-ui'

function tool(index: number, inputSize = 0): UIMessage['parts'][number] {
  return {
    type: 'tool-read',
    toolCallId: `call-${index}`,
    state: 'output-available',
    input: { path: 'document.txt', body: 'x'.repeat(inputSize) },
    output: 'x'.repeat(2000),
  }
}

function expectStable(messages: UIMessage[]) {
  expect(boundMessagePayload(messages)).toBe(messages)
  expect(slimMessagesForClientUi(messages)).toBe(messages)
  expect(JSON.stringify(messages)).not.toContain(
    'Details omitted from this preview',
  )
  expect(JSON.stringify(messages)).not.toContain(
    'pending tool approval must be retried',
  )
}

describe('boundMessagePayload', () => {
  test('keeps 300 ordinary tools in a 30-message chat without warning spam', () => {
    const messages: UIMessage[] = Array.from({ length: 30 }, (_, i) => ({
      id: `m-${i}`,
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Completed the work.' },
        ...Array.from({ length: 10 }, (_, j) => tool(i * 10 + j)),
      ],
    }))
    expect(slimMessagesForClientUi(messages)).toBe(messages)
    expectStable(messages)
  })

  test('preserves the complete research answer and pages overflow steps within one turn', () => {
    const answer = `## Galaxy S25 Ultra\n\n*r/samsung (285 comments)*\n\n${'- Owners report good battery life and cameras.\n'.repeat(200)}`
    const messages: UIMessage[] = [
      {
        id: 'research',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Collecting the research.\n'.repeat(50) },
          ...Array.from({ length: 300 }, (_, i) => tool(i, 50_000)),
          { type: 'text', text: answer },
        ],
      },
    ]
    const next = slimMessagesForClientUi(messages)
    expect(next[0].parts.includes(messages[0].parts.at(-1)!)).toBe(true)
    expect(next[0].parts.length).toBeLessThanOrEqual(UI_MESSAGE_PARTS)
    expect(contentPreview(next[0])?.totalParts).toBe(302)
    expect(next[0].parts.filter((part) => part.type === 'text')).toHaveLength(2)
    expect(JSON.stringify(next).length).toBeLessThan(1_000_000)
    expect(
      (messages[0].parts[1] as { input: { body: string } }).input.body,
    ).toHaveLength(50_000)
    expectStable(next)
  })

  for (const type of ['tool-read', 'dynamic-tool']) {
    test(`${type}: marks pending approvals and dry runs as display-only previews`, () => {
      for (const state of [
        'input-available',
        'approval-requested',
        'approval-responded',
        'output-available',
      ]) {
        const messages = [
          {
            id: 'm',
            role: 'assistant',
            parts: [
              {
                type,
                toolName: 'read',
                toolCallId: 'call',
                state,
                input: { body: 'x'.repeat(3_000_000) },
                output: {
                  content: [
                    { type: 'text', text: 'Dry-run. Ready to promote.' },
                  ],
                },
              },
            ],
          },
        ] as UIMessage[]
        const next = slimMessagesForClientUi(messages)
        expect(next[0].parts[0]).toMatchObject({
          type,
          state,
          inputPreviewed: true,
        })
        expect(JSON.stringify(next).length).toBeLessThan(16_000)
        expect(
          (messages[0].parts[0] as { input: { body: string } }).input.body,
        ).toHaveLength(3_000_000)
      }
    })
    test(`${type}: previews completed inputs while retaining tool identity and status`, () => {
      const messages = [
        {
          id: 'm',
          role: 'assistant',
          parts: [
            {
              type,
              toolName: 'read',
              toolCallId: 'call',
              state: 'output-available',
              input: { path: 'report.txt', body: 'x'.repeat(3_000_000) },
              output: { content: [{ type: 'text', text: 'Done' }] },
            },
          ],
        },
      ] as UIMessage[]
      const next = slimMessagesForClientUi(messages)
      expect(next[0].parts[0]).toMatchObject({
        type,
        toolCallId: 'call',
        state: 'output-available',
        inputPreviewed: true,
        input: { path: 'report.txt' },
      })
      expect(JSON.stringify(next).length).toBeLessThan(16_000)
      expectStable(next)
    })
  }

  test('bounds large text and reasoning, with validated attachments independently limited', () => {
    const messages: UIMessage[] = [
      {
        id: 'u',
        role: 'user',
        parts: [
          {
            type: 'file',
            mediaType: 'image/png',
            url: `data:image/png;base64,${'a'.repeat(2_000_000)}`,
          },
        ],
      },
      {
        id: 'a',
        role: 'assistant',
        parts: [
          { type: 'text', text: '漢😀\u0000'.repeat(300_000) },
          { type: 'reasoning', text: 'reasoning '.repeat(300_000) },
        ],
      },
    ]
    const next = slimMessagesForClientUi(messages)
    expect(next[0].parts[0]).toBe(messages[0].parts[0])
    expect(Buffer.byteLength(JSON.stringify(next[1]))).toBeLessThan(
      UI_TRANSCRIPT_BYTES,
    )
    expect(contentPreview(next[1])).toBeDefined()
    expect(
      (next[1].parts[0] as { text: string }).text.length,
    ).toBeLessThanOrEqual(64_000)
    expect(
      (next[1].parts[1] as { text: string }).text.length,
    ).toBeLessThanOrEqual(16_000)
    expect((messages[1].parts[1] as { text: string }).text.length).toBe(
      3_000_000,
    )
    expectStable(next)
  })

  test('strips oversized provider metadata without truncating answer text', () => {
    const messages = [
      {
        id: 'm',
        role: 'assistant',
        metadata: { data: 'x'.repeat(2_000_000) },
        parts: [
          {
            type: 'text',
            text: 'The complete answer.',
            providerMetadata: { test: { data: 'x'.repeat(2_000_000) } },
          },
        ],
      },
    ] as UIMessage[]
    const next = boundMessagePayload(messages)
    expect(next[0].parts).toEqual([
      { type: 'text', text: 'The complete answer.' },
    ])
    expectStable(next)
  })
})
