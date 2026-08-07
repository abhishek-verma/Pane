/**
 * @license
 * Copyright 2025 BrowserOS
 *
 * Mirrors test-provider.test.ts: guards that refinePrompt still surfaces
 * provider errors as failures (await stream.text rejects on our installed
 * ai@6.0.209) rather than a false "empty response" success.
 */

import { afterAll, describe, expect, it, mock } from 'bun:test'
import { createRequire } from 'node:module'
import { MockLanguageModelV3 } from 'ai/test'

const requireFromHere = createRequire(import.meta.url)
const realProviderModule = requireFromHere(
  '../../../../src/lib/clients/llm/provider.ts',
) as typeof import('../../../../src/lib/clients/llm/provider')

let mockModel: InstanceType<typeof MockLanguageModelV3> | null = null

mock.module('../../../../src/lib/clients/llm/provider', () => ({
  ...realProviderModule,
  createLLMProvider: () => {
    if (!mockModel) throw new Error('mockModel not set for this test')
    return mockModel
  },
}))

const { refinePrompt } = await import(
  '../../../../src/lib/clients/llm/refine-prompt'
)

afterAll(() => {
  mock.restore()
  mock.module(
    '../../../../src/lib/clients/llm/provider',
    () => realProviderModule,
  )
})

function baseConfig() {
  return {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-6',
    apiKey: 'sk-test',
  }
}

describe('refinePrompt error handling', () => {
  it('reports failure when the provider errors before streaming any token', async () => {
    mockModel = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error('fetch failed: ECONNREFUSED')
      },
    })

    const result = await refinePrompt(baseConfig(), {
      prompt: 'check competitor pricing',
      name: 'Pricing check',
    })

    expect(result.success).toBe(false)
    expect(result.refined).toBeUndefined()
  })

  it('returns the refined prompt on success', async () => {
    mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(ctrl) {
            ctrl.enqueue({ type: 'text-start', id: '1' })
            ctrl.enqueue({
              type: 'text-delta',
              id: '1',
              delta: 'Go to example.com and report the price.',
            })
            ctrl.enqueue({ type: 'text-end', id: '1' })
            ctrl.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 5, noCache: 5 },
                outputTokens: { total: 8, reasoning: undefined },
              },
            })
            ctrl.close()
          },
        }),
      }),
    })

    const result = await refinePrompt(baseConfig(), {
      prompt: 'check competitor pricing',
      name: 'Pricing check',
    })

    expect(result.success).toBe(true)
    expect(result.refined).toBe('Go to example.com and report the price.')
  })
})
