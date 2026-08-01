/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import { projectMessagesForUi } from '../../src/agent/project-messages-for-ui'

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
