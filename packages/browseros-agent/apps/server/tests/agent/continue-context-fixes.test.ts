/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import type { ModelMessage } from 'ai'
import { stripOrphanReasoningMessages } from '../../src/agent/compaction/content'
import { formatAgentStreamError } from '../../src/agent/durable-agent-ui-stream'
import { guardUiMessagesForContext } from '../../src/agent/guard-ui-messages-for-context'
import { resolveContextWindowSize } from '../../src/agent/resolve-context-window'

describe('stripOrphanReasoningMessages', () => {
  it('removes assistants that only have reasoning parts', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'think' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think' },
          { type: 'text', text: 'hello' },
        ],
      },
    ]
    const next = stripOrphanReasoningMessages(messages)
    expect(next).toHaveLength(2)
    expect(next[1]).toEqual(messages[2])
  })

  it('keeps assistants that still have tool calls', () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think' },
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'read',
            input: {},
          },
        ],
      },
    ]
    expect(stripOrphanReasoningMessages(messages)).toEqual(messages)
  })
})

describe('resolveContextWindowSize', () => {
  it('overrides stale DeepSeek V4 windows to 1M', () => {
    expect(resolveContextWindowSize('deepseek-v4-flash', 64000, 128000)).toBe(
      1_000_000,
    )
  })

  it('falls back for unknown models', () => {
    expect(resolveContextWindowSize('gpt-5', undefined, 128000)).toBe(128000)
    expect(resolveContextWindowSize('gpt-5', 200000, 128000)).toBe(200000)
  })
})

describe('guardUiMessagesForContext', () => {
  it('truncates fat tool outputs when transcript is huge', () => {
    const fat = 'x'.repeat(50_000)
    const messages = [
      {
        id: 'a1',
        role: 'assistant' as const,
        parts: [
          {
            type: 'tool-read',
            toolCallId: 'c1',
            state: 'output-available',
            output: {
              content: [{ type: 'text', text: fat }],
            },
          },
        ],
      },
    ]
    // Force trigger with a low threshold
    const result = guardUiMessagesForContext(messages as any, {
      triggerChars: 1000,
      previewMaxChars: 100,
    })
    expect(result.truncated).toBe(true)
    const out = (result.messages[0].parts[0] as any).output
    expect(out.content[0].text.length).toBeLessThan(fat.length)
    expect(out.content[0].text).toContain('truncated')
  })
})

describe('formatAgentStreamError cause walk', () => {
  it('skips opaque SDK default and surfaces the cause', () => {
    const err = new Error('An error occurred.')
    ;(err as Error & { cause?: unknown }).cause = new Error(
      '400 reasoning_content is required',
    )
    expect(formatAgentStreamError(err)).toContain('reasoning_content')
  })
})
