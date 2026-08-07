/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import type { LanguageModel } from 'ai'
import { createLLMProvider } from '../../../../src/lib/clients/llm/provider'
import type { ResolvedLLMConfig } from '../../../../src/lib/clients/llm/types'

/**
 * Same normalization as provider-factory-baseurl.test.ts: anthropic/google
 * stamp a plain `config.baseURL` string, openai/openrouter/azure only
 * expose a `config.url({modelId, path})` builder.
 */
function resolveEndpoint(model: LanguageModel): string {
  // biome-ignore lint/suspicious/noExplicitAny: introspecting AI SDK internals for test assertions
  const config = (model as any).config
  if (typeof config.baseURL === 'string') return config.baseURL
  if (typeof config.url === 'function') {
    return config.url({ modelId: (model as any).modelId, path: '/x' })
  }
  throw new Error('Could not resolve endpoint from model config')
}

function baseConfig(overrides: Partial<ResolvedLLMConfig>): ResolvedLLMConfig {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    ...overrides,
  }
}

describe('lib/clients/llm/provider baseUrl forwarding (test-provider / refine-prompt path)', () => {
  it('forwards a custom baseUrl for anthropic', () => {
    const model = createLLMProvider(
      baseConfig({
        provider: 'anthropic',
        apiKey: 'sk-test',
        baseUrl: 'https://api.minimax.io/anthropic',
      }),
    )
    expect(resolveEndpoint(model)).toBe('https://api.minimax.io/anthropic')
  })

  it('forwards a custom baseUrl for openai', () => {
    const model = createLLMProvider(
      baseConfig({
        provider: 'openai',
        model: 'gpt-5',
        apiKey: 'sk-test',
        baseUrl: 'https://litellm.internal/v1',
      }),
    )
    expect(resolveEndpoint(model)).toBe('https://litellm.internal/v1/x')
  })

  it('forwards a custom baseUrl for google', () => {
    const model = createLLMProvider(
      baseConfig({
        provider: 'google',
        model: 'gemini-2.5-flash',
        apiKey: 'sk-test',
        baseUrl: 'https://gateway.internal/v1beta',
      }),
    )
    expect(resolveEndpoint(model)).toBe('https://gateway.internal/v1beta')
  })

  it('forwards a custom baseUrl for openrouter', () => {
    const model = createLLMProvider(
      baseConfig({
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4.6',
        apiKey: 'sk-test',
        baseUrl: 'https://gateway.internal/openrouter/v1',
      }),
    )
    expect(resolveEndpoint(model)).toBe(
      'https://gateway.internal/openrouter/v1/x',
    )
  })

  it('forwards baseUrl for azure and it overrides resourceName', () => {
    const model = createLLMProvider(
      baseConfig({
        provider: 'azure',
        model: 'gpt-5',
        apiKey: 'sk-test',
        resourceName: 'should-be-ignored',
        baseUrl: 'https://gateway.internal/azure',
      }),
    )
    expect(resolveEndpoint(model)).toBe(
      'https://gateway.internal/azure/v1/x?api-version=v1',
    )
  })

  it('azure still resolves from resourceName when baseUrl is unset', () => {
    const model = createLLMProvider(
      baseConfig({
        provider: 'azure',
        model: 'gpt-5',
        apiKey: 'sk-test',
        resourceName: 'my-resource',
      }),
    )
    expect(resolveEndpoint(model)).toContain('my-resource')
  })

  it('azure throws when neither resourceName nor baseUrl is set', () => {
    expect(() =>
      createLLMProvider(
        baseConfig({ provider: 'azure', model: 'gpt-5', apiKey: 'sk-test' }),
      ),
    ).toThrow(/resourceName or baseUrl/)
  })
})
