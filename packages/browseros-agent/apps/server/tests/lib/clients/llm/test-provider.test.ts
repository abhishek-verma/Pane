/**
 * @license
 * Copyright 2025 BrowserOS
 *
 * Regression coverage for testProviderConnection's error handling. On
 * ai@6.0.209, `await stream.text` already rejects on provider failures
 * (verified empirically against a real connection-refused endpoint and a
 * real HTTP 401 from the Anthropic API) — these tests guard that behavior
 * so a future `ai` SDK change can't silently reintroduce a false-success
 * report on the "Test connection" button.
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

const { testProviderConnection } = await import(
  '../../../../src/lib/clients/llm/test-provider'
)

afterAll(() => {
  mock.restore()
  mock.module(
    '../../../../src/lib/clients/llm/provider',
    () => realProviderModule,
  )
})

function baseTestConfig() {
  return {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-6',
    apiKey: 'sk-test',
  }
}

describe('testProviderConnection error handling', () => {
  it('reports failure when the provider errors before streaming any token', async () => {
    mockModel = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error('fetch failed: ECONNREFUSED')
      },
    })

    const result = await testProviderConnection(baseTestConfig())

    expect(result.success).toBe(false)
    expect(result.message).toContain('anthropic')
  })

  it('reports failure when the provider errors mid-stream', async () => {
    mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          async start(ctrl) {
            ctrl.enqueue({ type: 'text-start', id: '1' })
            ctrl.enqueue({ type: 'text-delta', id: '1', delta: 'partial ' })
            await new Promise((resolve) => setTimeout(resolve, 5))
            ctrl.error(new Error('simulated mid-stream provider failure'))
          },
        }),
      }),
    })

    const result = await testProviderConnection(baseTestConfig())

    expect(result.success).toBe(false)
    expect(result.message).toContain('anthropic')
  })

  it('reports success on a normal response', async () => {
    mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(ctrl) {
            ctrl.enqueue({ type: 'text-start', id: '1' })
            ctrl.enqueue({ type: 'text-delta', id: '1', delta: 'ok' })
            ctrl.enqueue({ type: 'text-end', id: '1' })
            ctrl.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 5, noCache: 5 },
                outputTokens: { total: 1, reasoning: undefined },
              },
            })
            ctrl.close()
          },
        }),
      }),
    })

    const result = await testProviderConnection(baseTestConfig())

    expect(result.success).toBe(true)
    expect(result.message).toContain('ok')
  })
})
