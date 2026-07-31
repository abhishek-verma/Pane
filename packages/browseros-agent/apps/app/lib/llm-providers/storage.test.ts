import { describe, expect, it } from 'bun:test'
import {
  migrateLlmProvidersToV3,
  migrateLlmProvidersToV4,
  normalizeProviderNames,
} from './provider-name-normalization'
import type { LlmProviderConfig } from './types'

function providerConfig(
  overrides: Partial<LlmProviderConfig> & Pick<LlmProviderConfig, 'id'>,
): LlmProviderConfig {
  return {
    type: 'openai',
    name: 'OpenAI',
    modelId: 'gpt-5',
    supportsImages: true,
    contextWindow: 400000,
    temperature: 0.2,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

describe('normalizeProviderNames', () => {
  it('normalizes legacy ChatGPT display names', () => {
    const providers = normalizeProviderNames([
      providerConfig({
        id: 'chatgpt-pro-1',
        type: 'chatgpt-pro',
        name: 'ChatGPT Plus/Pro',
      }),
      providerConfig({
        id: 'chatgpt-pro-2',
        type: 'chatgpt-pro',
        name: 'ChatGPT Plus/Pro (user@example.com)',
      }),
    ])

    expect(providers.map((provider) => provider.name)).toEqual([
      'ChatGPT',
      'ChatGPT',
    ])
  })

  it('preserves custom ChatGPT provider names', () => {
    const providers = normalizeProviderNames([
      providerConfig({
        id: 'chatgpt-pro-custom',
        type: 'chatgpt-pro',
        name: 'Work ChatGPT',
      }),
      providerConfig({
        id: 'chatgpt-pro-parenthetical-custom',
        type: 'chatgpt-pro',
        name: 'ChatGPT Plus/Pro (Work)',
      }),
    ])

    expect(providers.map((provider) => provider.name)).toEqual([
      'Work ChatGPT',
      'ChatGPT Plus/Pro (Work)',
    ])
  })
})

describe('migrateLlmProvidersToV3', () => {
  it('migrates legacy ChatGPT display names for direct storage reads', () => {
    const providers = migrateLlmProvidersToV3([
      providerConfig({
        id: 'chatgpt-pro-1',
        type: 'chatgpt-pro',
        name: 'ChatGPT Plus/Pro (user@example.com)',
      }),
    ])

    expect(providers?.map((provider) => provider.name)).toEqual(['ChatGPT'])
  })
})

describe('migrateLlmProvidersToV4', () => {
  it('bumps stale DeepSeek V4 context windows to 1M', () => {
    const providers = migrateLlmProvidersToV4([
      providerConfig({
        id: 'deepseek-1',
        type: 'deepseek',
        name: 'DeepSeek',
        modelId: 'deepseek-v4-flash',
        contextWindow: 64000,
      }),
    ])

    expect(providers?.[0]?.contextWindow).toBe(1_000_000)
  })
})
