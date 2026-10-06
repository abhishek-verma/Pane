import { describe, expect, it } from 'bun:test'
import { providerFormSchema } from '@/screens/ai-settings/provider-form-schema'
import { isOAuthProviderType, OAUTH_PROVIDERS_CONFIG } from './oauth-providers'
import {
  isAcpProviderType,
  isProviderTestable,
  normalizeReasoningEffort,
  PROVIDER_AUTH_KIND,
} from './provider-setup'
import type { ProviderType } from './types'

const base = {
  name: 'Provider',
  modelId: 'unlisted-current-model',
  supportsImages: true,
  contextWindow: 128000,
  temperature: 0.2,
}

describe('provider setup matrix', () => {
  for (const type of Object.keys(PROVIDER_AUTH_KIND) as ProviderType[]) {
    it(`${type}: accepts unlisted models with the appropriate credentials and aligns Test`, () => {
      const kind = PROVIDER_AUTH_KIND[type]
      const credentials =
        kind === 'api-key'
          ? { baseUrl: 'https://api.example/v1', apiKey: 'key' }
          : kind === 'optional-api-key'
            ? { baseUrl: 'http://localhost:1234/v1' }
            : kind === 'aws'
              ? {
                  accessKeyId: 'key',
                  secretAccessKey: 'secret',
                  region: 'us-east-1',
                  sessionToken: 'token',
                }
              : kind === 'azure'
                ? { resourceName: 'resource', apiKey: 'key' }
                : kind === 'custom-agent'
                  ? { acpAgentId: 'custom', acpCommand: 'agent acp' }
                  : {}
      const draft = { ...base, type, ...credentials }
      expect(providerFormSchema.safeParse(draft).success).toBe(true)
      expect(isProviderTestable(draft)).toBe(type !== 'remote-hermes')
      expect(isAcpProviderType(type)).toBe(
        kind === 'cli' || kind === 'custom-agent',
      )
      expect(isOAuthProviderType(type)).toBe(kind === 'oauth')
    })
    if (PROVIDER_AUTH_KIND[type] === 'api-key') {
      it(`${type}: both Save and Test reject a missing API key`, () => {
        const draft = { ...base, type, baseUrl: 'https://api.example/v1' }
        expect(providerFormSchema.safeParse(draft).success).toBe(false)
        expect(isProviderTestable(draft)).toBe(false)
      })
    }
  }
  it('keeps native default reasoning valid for Claude Code and Codex', () => {
    for (const type of ['claude-code', 'codex'] as const) {
      const reasoningEffort = normalizeReasoningEffort('default')
      expect(reasoningEffort).toBeUndefined()
      expect(
        providerFormSchema.safeParse({ ...base, type, reasoningEffort })
          .success,
      ).toBe(true)
      expect(normalizeReasoningEffort('high')).toBe('high')
    }
  })
  it('requires both an agent ID and command for a custom agent', () => {
    for (const fields of [
      { acpCommand: 'agent acp' },
      { acpAgentId: 'custom' },
    ]) {
      const draft = { ...base, type: 'acp-custom' as const, ...fields }
      expect(providerFormSchema.safeParse(draft).success).toBe(false)
      expect(isProviderTestable(draft)).toBe(false)
    }
  })
  it('registers every OAuth provider with shared setup configuration', () => {
    for (const [type, config] of Object.entries(OAUTH_PROVIDERS_CONFIG)) {
      expect(String(config.providerType)).toBe(type)
      expect(PROVIDER_AUTH_KIND[config.providerType]).toBe('oauth')
    }
  })
})
