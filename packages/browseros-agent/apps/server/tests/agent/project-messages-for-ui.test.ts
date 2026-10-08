/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import { stripUIImageOutputs } from '../../src/agent/message-validation'
import {
  projectMessagesForUi,
  projectMessagesSnapshotForUi,
} from '../../src/agent/project-messages-for-ui'

class MemoryOutputStore {
  map = new Map<string, string>()
  store(
    _sessionId: string,
    toolCallId: string,
    data: string,
    _mimeType?: string,
  ): boolean {
    this.map.set(toolCallId, data)
    return true
  }
  get(toolCallId: string) {
    const data = this.map.get(toolCallId)
    return data ? { data, mimeType: 'application/json' } : null
  }
  deleteForSession() {}
}

describe('projectMessagesForUi', () => {
  it('snapshot projection preserves legacy output and isolates source and later writes', () => {
    const original: UIMessage[] = [
      {
        id: 'snapshot',
        role: 'assistant',
        parts: [
          {
            type: 'tool-screenshot',
            toolCallId: 'image',
            state: 'output-available',
            input: { target: { tab: 1 } },
            output: {
              content: [
                { type: 'image', data: 'abc123', mimeType: 'image/png' },
              ],
              structuredContent: {
                image: 'abc123',
                format: 'png',
                nested: { value: 1 },
              },
            },
          } as never,
        ],
      },
    ]
    const saved = structuredClone(original)
    const imageWrites: unknown[][] = []
    const options = {
      sessionId: 'snapshot-test',
      imageStore: {
        store: (...args: unknown[]) => {
          imageWrites.push(args)
          return true
        },
      } as never,
      outputStore: new MemoryOutputStore() as never,
    }
    const legacy = structuredClone(original)
    stripUIImageOutputs(legacy, options.sessionId, options.imageStore)
    const expected = projectMessagesForUi(legacy, options)
    imageWrites.length = 0
    const actual = projectMessagesSnapshotForUi(original, options)
    expect(actual).toEqual(expected)
    expect(imageWrites).toHaveLength(2)
    expect(original).toEqual(saved)
    const sourcePart = original[0].parts[0] as any
    sourcePart.input.target.tab = 2
    sourcePart.output.structuredContent.nested.value = 2
    expect(actual).toEqual(expected)
    const projectedPart = actual[0].parts[0] as any
    projectedPart.input.target.tab = 3
    expect(sourcePart.input.target.tab).toBe(2)
  })

  it('snapshot projection matches the previous path for long histories and large approvals', () => {
    const original: UIMessage[] = Array.from({ length: 100 }, (_, index) => ({
      id: String(index),
      role: 'assistant',
      parts: [
        {
          type: 'tool-write',
          toolCallId: `tool-${index}`,
          state: 'approval-requested',
          approval: { id: `approval-${index}` },
          input: { content: 'source'.repeat(30_000) },
        } as never,
      ],
    }))
    const options = {
      sessionId: 'long-snapshot',
      imageStore: { store: () => true } as never,
      outputStore: new MemoryOutputStore() as never,
    }
    const actual = projectMessagesSnapshotForUi(original, options)
    expect(actual).toEqual(
      projectMessagesForUi(structuredClone(original), options),
    )
    expect(actual).toHaveLength(60)
    expect((actual.at(-1)!.parts[0] as any).inputPreviewed).toBe(true)
    expect((original.at(-1)!.parts[0] as any).input.content.length).toBe(
      180_000,
    )
  })

  it('does not mutate the agent transcript', () => {
    const fat = 'x'.repeat(8_000)
    const original: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-navigate',
            toolCallId: 'call-1',
            state: 'output-available',
            input: { url: 'https://example.com' },
            output: {
              content: [{ type: 'text', text: fat }],
            },
          } as never,
        ],
      },
    ]
    const store = new MemoryOutputStore()
    const projected = projectMessagesForUi(original, {
      sessionId: 's1',
      outputStore: store as never,
      previewMaxChars: 100,
    })
    expect(projected).not.toBe(original)
    const origOut = (
      original[0].parts[0] as { output: { content: Array<{ text: string }> } }
    ).output.content[0].text
    expect(origOut.length).toBe(8_000)
    const projPart = projected[0].parts[0] as {
      output: {
        spilled?: boolean
        preview?: string
        content: Array<{ text: string }>
      }
    }
    expect(projPart.output.spilled).toBe(true)
    expect(projPart.output.content[0].text.length).toBeLessThan(200)
    expect(store.get('call-1')?.data).toContain(fat)
  })

  it('leaves small tool outputs unchanged (same message refs)', () => {
    const original: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-tabs',
            toolCallId: 'call-2',
            state: 'output-available',
            input: {},
            output: { content: [{ type: 'text', text: 'ok' }] },
          } as never,
        ],
      },
    ]
    const store = new MemoryOutputStore()
    const projected = projectMessagesForUi(original, {
      sessionId: 's1',
      outputStore: store as never,
    })
    expect(projected).toBe(original)
    expect(store.map.size).toBe(0)
  })

  it('strips inline image data without requiring a tool-output spill', () => {
    const original: UIMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'call-img',
            state: 'output-available',
            input: {},
            output: {
              content: [
                { type: 'text', text: 'ok' },
                {
                  type: 'image',
                  data: 'abc123',
                  mimeType: 'image/jpeg',
                },
              ],
            },
          } as never,
        ],
      },
    ]
    const store = new MemoryOutputStore()
    const projected = projectMessagesForUi(original, {
      sessionId: 's1',
      outputStore: store as never,
    })
    expect(projected).not.toBe(original)
    const content = (
      projected[0].parts[0] as {
        output: { content: Array<Record<string, unknown>>; spilled?: boolean }
      }
    ).output.content
    expect(content[1]?.stripped).toBe(true)
    expect(content[1]?.data).toBeUndefined()
    expect(store.map.size).toBe(0)
  })
})
