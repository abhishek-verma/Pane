import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { testProvider } from './testProvider'
import type { LlmProviderConfig } from './types'

let lastCall: { url: string; body: Record<string, unknown> } | null = null
let originalFetch: typeof globalThis.fetch

beforeEach(() => {
  lastCall = null
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    lastCall = {
      url: typeof input === 'string' ? input : input.toString(),
      body: init?.body ? JSON.parse(init.body as string) : {},
    }
    return {
      ok: true,
      json: async () => ({ success: true, message: 'ok' }),
    } as Response
  }) as typeof globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function baseProvider(
  overrides: Partial<LlmProviderConfig> = {},
): LlmProviderConfig {
  return {
    id: 'p-1',
    type: 'anthropic',
    name: 'Anthropic',
    modelId: 'claude-sonnet-4-6',
    supportsImages: true,
    contextWindow: 200000,
    temperature: 0.2,
    createdAt: 1,
    updatedAt: 1,
    apiKey: 'sk-test',
    ...overrides,
  }
}

describe('testProvider — request body', () => {
  it('forwards model-backed fields for non-ACP providers', async () => {
    await testProvider(baseProvider(), 'http://127.0.0.1:9000')
    expect(lastCall?.url).toBe('http://127.0.0.1:9000/test-provider')
    expect(lastCall?.body).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-test',
    })
  })

  it('forwards ACP fields when present', async () => {
    await testProvider(
      baseProvider({
        type: 'claude-code',
        apiKey: undefined,
        acpAgentId: 'claude',
        acpFixedWorkspacePath: '/tmp/x',
      }),
      'http://127.0.0.1:9000',
    )
    expect(lastCall?.body).toMatchObject({
      provider: 'claude-code',
      acpAgentId: 'claude',
      acpFixedWorkspacePath: '/tmp/x',
    })
  })

  it('forwards acp-custom command for the probe spawn path', async () => {
    await testProvider(
      baseProvider({
        type: 'acp-custom',
        acpAgentId: 'my-agent',
        acpCommand: 'my-bin acp',
      }),
      'http://127.0.0.1:9000',
    )
    expect(lastCall?.body).toMatchObject({
      provider: 'acp-custom',
      acpAgentId: 'my-agent',
      acpCommand: 'my-bin acp',
    })
  })
})

describe('testProvider — local server unreachable', () => {
  it('wraps a fetch failure with a clear local-server-unreachable message', async () => {
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      throw new Error('Failed to fetch')
    }) as typeof globalThis.fetch

    const result = await testProvider(baseProvider(), 'http://127.0.0.1:9200')

    expect(result.success).toBe(false)
    expect(result.message).toContain(
      'Could not reach the local Pane server at http://127.0.0.1:9200',
    )
    expect(result.message).toContain('Failed to fetch')
  })
})
