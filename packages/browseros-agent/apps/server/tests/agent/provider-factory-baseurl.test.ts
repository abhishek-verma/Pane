/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import type { LanguageModel } from 'ai'
import { createLanguageModel } from '../../src/agent/provider-factory'
import type { ResolvedAgentConfig } from '../../src/agent/types'

/**
 * The AI SDK exposes the resolved endpoint differently per provider:
 * anthropic/google stamp a plain `config.baseURL` string, while
 * openai/openrouter/azure only expose a `config.url({modelId, path})`
 * builder. Normalize both shapes to the string actually used for requests.
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

function baseConfig(
  overrides: Partial<ResolvedAgentConfig>,
): ResolvedAgentConfig {
  return {
    conversationId: 'c1',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    ...overrides,
  }
}

describe('provider-factory baseUrl forwarding', () => {
  it('forwards a custom baseUrl for anthropic', async () => {
    const { model } = await createLanguageModel(
      baseConfig({
        provider: 'anthropic',
        apiKey: 'sk-test',
        baseUrl: 'https://api.minimax.io/anthropic',
      }),
    )
    expect(resolveEndpoint(model)).toBe('https://api.minimax.io/anthropic')
  })

  it('keeps the anthropic default when baseUrl is unset', async () => {
    const { model } = await createLanguageModel(
      baseConfig({ provider: 'anthropic', apiKey: 'sk-test' }),
    )
    expect(resolveEndpoint(model)).toBe('https://api.anthropic.com/v1')
  })

  it('treats an empty-string baseUrl as unset for anthropic', async () => {
    const { model } = await createLanguageModel(
      baseConfig({ provider: 'anthropic', apiKey: 'sk-test', baseUrl: '' }),
    )
    expect(resolveEndpoint(model)).toBe('https://api.anthropic.com/v1')
  })

  it('forwards a custom baseUrl for openai', async () => {
    const { model } = await createLanguageModel(
      baseConfig({
        provider: 'openai',
        model: 'gpt-5',
        apiKey: 'sk-test',
        baseUrl: 'https://litellm.internal/v1',
      }),
    )
    expect(resolveEndpoint(model)).toBe('https://litellm.internal/v1/x')
  })

  it('forwards a custom baseUrl for google', async () => {
    const { model } = await createLanguageModel(
      baseConfig({
        provider: 'google',
        model: 'gemini-2.5-flash',
        apiKey: 'sk-test',
        baseUrl: 'https://gateway.internal/v1beta',
      }),
    )
    expect(resolveEndpoint(model)).toBe('https://gateway.internal/v1beta')
  })

  it('keeps the google default when baseUrl is unset', async () => {
    const { model } = await createLanguageModel(
      baseConfig({
        provider: 'google',
        model: 'gemini-2.5-flash',
        apiKey: 'sk-test',
      }),
    )
    expect(resolveEndpoint(model)).toBe(
      'https://generativelanguage.googleapis.com/v1beta',
    )
  })

  it('forwards a custom baseUrl for openrouter', async () => {
    const { model } = await createLanguageModel(
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

  it('forwards baseUrl for azure and it overrides resourceName', async () => {
    const { model } = await createLanguageModel(
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

  it('azure still resolves from resourceName when baseUrl is unset', async () => {
    const { model } = await createLanguageModel(
      baseConfig({
        provider: 'azure',
        model: 'gpt-5',
        apiKey: 'sk-test',
        resourceName: 'my-resource',
      }),
    )
    expect(resolveEndpoint(model)).toContain('my-resource')
  })

  it('azure throws when neither resourceName nor baseUrl is set', async () => {
    await expect(
      createLanguageModel(
        baseConfig({ provider: 'azure', model: 'gpt-5', apiKey: 'sk-test' }),
      ),
    ).rejects.toThrow(/resourceName or baseUrl/)
  })
})
