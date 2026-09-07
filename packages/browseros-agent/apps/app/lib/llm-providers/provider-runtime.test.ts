import { describe, expect, it } from 'bun:test'
import { resolveCloudChatProvider } from './provider-runtime'
import type { LlmProviderConfig } from './types'

const codexProvider: LlmProviderConfig = {
  id: 'codex',
  type: 'codex',
  name: 'Codex',
  modelId: 'gpt-6-astra',
  supportsImages: false,
  contextWindow: 400000,
  temperature: 0.2,
  createdAt: 0,
  updatedAt: 0,
}

describe('resolveCloudChatProvider', () => {
  it('keeps a local ACP provider eligible for local scheduled chat routes', () => {
    expect(resolveCloudChatProvider([codexProvider])).toEqual(codexProvider)
  })

  it('honors an explicitly selected local ACP provider', () => {
    const cloudProvider: LlmProviderConfig = {
      ...codexProvider,
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
    }

    expect(
      resolveCloudChatProvider([cloudProvider, codexProvider], 'codex'),
    ).toEqual(codexProvider)
  })
})
