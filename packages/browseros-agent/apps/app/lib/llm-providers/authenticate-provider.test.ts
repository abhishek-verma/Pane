import { afterEach, describe, expect, it, mock } from 'bun:test'
import { OAUTH_PROVIDERS_CONFIG } from './oauth-providers'

mock.module('@wxt-dev/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: async () => null,
      setValue: async () => {},
      watch: () => () => {},
    }),
  },
}))
const { authenticateProvider } = await import('./authenticate-provider')
const { awaitDeviceToken } = await import('./client-oauth')
const { waitForOAuthPoll } = await import('./oauth-polling')
const realFetch = globalThis.fetch
const device = {
  device_code: 'device',
  user_code: 'CODE',
  verification_uri: 'https://example.test/verify',
  expires_in: 300,
  interval: 1,
}
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('shared provider authentication', () => {
  it('launches ChatGPT from JSON and waits for a fresh authenticated status', async () => {
    const urls: string[] = []
    let statusPolls = 0
    const fetchFn = mock(async (url: RequestInfo | URL) => {
      urls.push(String(url))
      return Response.json(
        String(url).includes('/start')
          ? { authUrl: 'https://example.test/login' }
          : {
              authenticated: true,
              provider: 'chatgpt-pro',
              pending: ++statusPolls === 1,
            },
      )
    })
    const openTab = mock(async () => {})
    const result = await authenticateProvider(
      OAUTH_PROVIDERS_CONFIG['chatgpt-pro'],
      'http://localhost:9100',
      {
        signal: new AbortController().signal,
        fetch: fetchFn,
        openTab,
        wait: async () => {},
        onDeviceCode() {},
      },
    )
    expect(result.authenticated).toBe(true)
    expect(openTab).toHaveBeenCalledWith('https://example.test/login')
    expect(urls).toEqual([
      'http://localhost:9100/oauth/chatgpt-pro/start?format=json',
      'http://localhost:9100/oauth/chatgpt-pro/status',
      'http://localhost:9100/oauth/chatgpt-pro/status',
    ])
  })
  for (const provider of ['github-copilot', 'qwen-code'] as const) {
    it(`${provider}: shows a device code, stores tokens, then checks status`, async () => {
      const requests: RequestInit[] = []
      globalThis.fetch = (async (
        _url: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        requests.push(init ?? {})
        return Response.json(
          requests.length === 1
            ? device
            : {
                access_token: 'test-token',
                refresh_token: 'refresh',
                expires_in: 300,
              },
        )
      }) as unknown as typeof fetch
      const calls: string[] = []
      const fetchFn = mock(async (url: RequestInfo | URL) => {
        calls.push(String(url))
        return Response.json({ authenticated: true, provider })
      })
      const onDeviceCode = mock(() => {})
      await authenticateProvider(
        OAUTH_PROVIDERS_CONFIG[provider],
        'http://localhost:9100',
        {
          signal: new AbortController().signal,
          fetch: fetchFn,
          openTab: async () => {},
          wait: async () => {},
          onDeviceCode,
        },
      )
      expect(onDeviceCode).toHaveBeenCalledWith({
        userCode: 'CODE',
        providerName: OAUTH_PROVIDERS_CONFIG[provider].displayName,
        verificationUri: device.verification_uri,
      })
      expect(calls).toEqual([
        `http://localhost:9100/oauth/${provider}/token`,
        `http://localhost:9100/oauth/${provider}/status`,
      ])
      expect(String(requests[0].body).includes('code_challenge')).toBe(
        provider === 'qwen-code',
      )
      expect(String(requests[1].body).includes('code_verifier')).toBe(
        provider === 'qwen-code',
      )
    })
  }
  it('does not report success when the local token save fails', async () => {
    let calls = 0
    globalThis.fetch = (async () =>
      Response.json(
        ++calls === 1 ? device : { access_token: 'token' },
      )) as unknown as typeof fetch
    await expect(
      authenticateProvider(
        OAUTH_PROVIDERS_CONFIG['github-copilot'],
        'http://localhost:9100',
        {
          signal: new AbortController().signal,
          fetch: async () => new Response('', { status: 500 }),
          openTab: async () => {},
          wait: async () => {},
          onDeviceCode() {},
        },
      ),
    ).rejects.toThrow('Could not save GitHub Copilot sign-in')
  })
  it('cancelling device login prevents later token storage', async () => {
    const controller = new AbortController()
    globalThis.fetch = (async () =>
      Response.json(device)) as unknown as typeof fetch
    const fetchFn = mock(async () => Response.json({}))
    await expect(
      authenticateProvider(
        OAUTH_PROVIDERS_CONFIG['qwen-code'],
        'http://localhost:9100',
        {
          signal: controller.signal,
          fetch: fetchFn,
          openTab: async () => {
            controller.abort()
          },
          wait: async () => {},
          onDeviceCode() {},
        },
      ),
    ).rejects.toHaveProperty('name', 'AbortError')
    expect(fetchFn).not.toHaveBeenCalled()
  })
  it('rejects denied or expired device codes', async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { error: 'access_denied' },
        { status: 400 },
      )) as unknown as typeof fetch
    await expect(
      awaitDeviceToken(
        OAUTH_PROVIDERS_CONFIG['github-copilot'].clientAuth,
        device,
        undefined,
        new AbortController().signal,
        async () => {},
      ),
    ).rejects.toThrow('access_denied')
    await expect(
      awaitDeviceToken(
        OAUTH_PROVIDERS_CONFIG['qwen-code'].clientAuth,
        { ...device, expires_in: -1 },
        undefined,
        new AbortController().signal,
        async () => {},
      ),
    ).rejects.toThrow('Sign-in expired')
  })
  it('respects authorization_pending and slow_down before accepting a token', async () => {
    const replies = [
      { error: 'authorization_pending' },
      { error: 'slow_down' },
      { access_token: 'token' },
    ]
    globalThis.fetch = (async () =>
      Response.json(replies.shift())) as unknown as typeof fetch
    const delays: number[] = []
    const token = await awaitDeviceToken(
      OAUTH_PROVIDERS_CONFIG['github-copilot'].clientAuth,
      device,
      undefined,
      new AbortController().signal,
      async (ms) => {
        delays.push(ms)
      },
    )
    expect(token.accessToken).toBe('token')
    expect(delays).toEqual([4000, 4000, 9000])
  })
  it('immediately stops pending waits when cancelled', async () => {
    const controller = new AbortController()
    const pending = waitForOAuthPoll(300_000, controller.signal)
    controller.abort()
    await expect(pending).rejects.toHaveProperty('name', 'AbortError')
  })
})
