/**
 * @license
 * Copyright 2025 BrowserOS
 *
 * getMessageNormalizationOptions / normalizeMessagesForModel — Test Suite
 *
 * Covers the server-side `supportsImages` capability override: the client
 * sends this flag per-provider (not per-model) and it defaults to true when
 * unset, so a stale/wrong client value previously reached the model API
 * unchecked. No Deepseek model supports vision today, so a tool-result
 * screenshot rehydrated after a mid-session switch into Deepseek would be
 * kept as an `image_url` content part and rejected by Deepseek's API with
 * "unknown variant `image_url`, expected `text`". The override forces
 * `supportsImages=false` for Deepseek regardless of what the client sends.
 */

import { describe, expect, it } from 'bun:test'
import type { ModelMessage } from 'ai'
import {
  getMessageNormalizationOptions,
  normalizeMessagesForModel,
} from '../../src/agent/message-normalization'
import type { ResolvedAgentConfig } from '../../src/agent/types'

function makeConfig(
  overrides: Partial<ResolvedAgentConfig>,
): ResolvedAgentConfig {
  return {
    conversationId: 'conv-1',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    ...overrides,
  } as ResolvedAgentConfig
}

describe('getMessageNormalizationOptions — supportsImages override', () => {
  it('forces supportsImages=false for deepseek even when the client sends true', () => {
    const options = getMessageNormalizationOptions(
      makeConfig({ provider: 'deepseek', supportsImages: true }),
    )
    expect(options.supportsImages).toBe(false)
  })

  it('forces supportsImages=false for deepseek when the client omits the flag (default-true)', () => {
    const options = getMessageNormalizationOptions(
      makeConfig({ provider: 'deepseek', supportsImages: undefined }),
    )
    expect(options.supportsImages).toBe(false)
  })

  it('leaves supportsImages as client-supplied for non-deepseek providers', () => {
    const optionsTrue = getMessageNormalizationOptions(
      makeConfig({ provider: 'anthropic', supportsImages: true }),
    )
    expect(optionsTrue.supportsImages).toBe(true)

    const optionsFalse = getMessageNormalizationOptions(
      makeConfig({ provider: 'anthropic', supportsImages: false }),
    )
    expect(optionsFalse.supportsImages).toBe(false)
  })

  it('defaults supportsImages to true for non-deepseek providers when omitted', () => {
    const options = getMessageNormalizationOptions(
      makeConfig({ provider: 'openai', supportsImages: undefined }),
    )
    expect(options.supportsImages).toBe(true)
  })
})

describe('normalizeMessagesForModel — deepseek image tool-result end to end', () => {
  it('strips image content from a tool result instead of forwarding it as image_url', () => {
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'screenshot',
            input: {},
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'screenshot',
            output: {
              type: 'content',
              value: [
                {
                  type: 'media',
                  data: 'BASE64IMAGEDATA',
                  mediaType: 'image/jpeg',
                },
              ],
            },
          },
        ],
      },
    ]

    const options = getMessageNormalizationOptions(
      makeConfig({ provider: 'deepseek', supportsImages: true }),
    )
    const normalized = normalizeMessagesForModel(messages, options)

    // No message should carry an image/media part through to the request body.
    for (const message of normalized) {
      if (message.role !== 'user' && message.role !== 'tool') continue
      for (const part of message.content as unknown[]) {
        const p = part as { type?: string }
        expect(p.type).not.toBe('image')
        expect(p.type).not.toBe('media')
      }
    }
  })
})
