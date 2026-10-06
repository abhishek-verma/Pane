import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { OAuthCallbackServer } from '../../../../src/lib/clients/oauth/callback-server'
import {
  OAuthTokenManager,
  type OAuthTokenStore,
} from '../../../../src/lib/clients/oauth/token-manager'
import { runWithProfileAsync } from '../../../../src/lib/profile-context'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
function setup() {
  const store = {
    getStatus: (_id: string, provider: string) => ({
      authenticated: true,
      provider,
    }),
    upsertTokens: mock(() => {}),
    getTokens: () => null,
    deleteTokens: () => {},
  } satisfies OAuthTokenStore
  const callback = {
    ensureRunning: async () => {},
    stop() {},
  } as unknown as OAuthCallbackServer
  return { manager: new OAuthTokenManager(store, 'browser', callback), store }
}

describe('OAuth reconnect status', () => {
  it('keeps existing credentials but marks a new login pending until its callback completes', async () => {
    const { manager, store } = setup()
    const url = await manager.generateAuthorizationUrl('chatgpt-pro')
    expect(manager.getStatus('chatgpt-pro')).toMatchObject({
      authenticated: true,
      pending: true,
    })
    globalThis.fetch = (async () =>
      Response.json({
        access_token: 'test-token',
        refresh_token: 'refresh',
        expires_in: 3600,
      })) as unknown as typeof fetch
    await manager.handleCallback(
      'code',
      new URL(url).searchParams.get('state') ?? '',
    )
    expect(manager.getStatus('chatgpt-pro')).toMatchObject({
      authenticated: true,
      pending: false,
    })
    expect(store.upsertTokens).toHaveBeenCalledTimes(1)
  })
  it('a retry supersedes the previous login in the same profile', async () => {
    const { manager } = setup()
    const oldUrl = await manager.generateAuthorizationUrl('chatgpt-pro')
    await manager.generateAuthorizationUrl('chatgpt-pro')
    await expect(
      manager.handleCallback(
        'code',
        new URL(oldUrl).searchParams.get('state') ?? '',
      ),
    ).rejects.toThrow('Invalid or expired OAuth state')
    expect(manager.getStatus('chatgpt-pro').pending).toBe(true)
  })
  it('does not expose a different profile’s pending login', async () => {
    const { manager } = setup()
    await runWithProfileAsync('11111111-1111-4111-8111-111111111111', () =>
      manager.generateAuthorizationUrl('chatgpt-pro'),
    )
    expect(
      await runWithProfileAsync(
        '22222222-2222-4222-8222-222222222222',
        async () => manager.getStatus('chatgpt-pro').pending,
      ),
    ).toBe(false)
    expect(
      await runWithProfileAsync(
        '11111111-1111-4111-8111-111111111111',
        async () => manager.getStatus('chatgpt-pro').pending,
      ),
    ).toBe(true)
  })
})
