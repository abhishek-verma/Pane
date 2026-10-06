import { describe, expect, it, mock } from 'bun:test'

mock.module('@wxt-dev/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: async () => null,
      setValue: async () => {},
      watch: () => () => {},
    }),
  },
}))

const { requestServerOAuth } = await import('./server-oauth')

describe('requestServerOAuth', () => {
  it('requests a JSON login URL without following an external redirect', async () => {
    const fetchFn = mock(async () =>
      Response.json({ authUrl: 'https://auth.example/login' }),
    )
    expect(
      await requestServerOAuth('http://localhost:9100', 'chatgpt-pro', fetchFn),
    ).toEqual({ authUrl: 'https://auth.example/login' })
    expect(fetchFn).toHaveBeenCalledWith(
      'http://localhost:9100/oauth/chatgpt-pro/start?format=json',
      { redirect: 'error' },
    )
  })
  it('preserves device-code login responses', async () => {
    const response = {
      userCode: 'ABCD',
      verificationUri: 'https://auth.example/device',
    }
    expect(
      await requestServerOAuth(
        'http://localhost:9100',
        'github-copilot',
        async () => Response.json(response),
      ),
    ).toEqual(response)
  })
  it('surfaces actionable server errors', async () => {
    await expect(
      requestServerOAuth('http://localhost:9100', 'chatgpt-pro', async () =>
        Response.json(
          { error: 'OAuth callback port is in use' },
          { status: 503 },
        ),
      ),
    ).rejects.toThrow('OAuth callback port is in use')
  })
  it('rejects missing or malformed login responses', async () => {
    for (const body of [null, {}, { authUrl: '' }, { userCode: 'ABCD' }]) {
      await expect(
        requestServerOAuth('http://localhost:9100', 'chatgpt-pro', async () =>
          Response.json(body),
        ),
      ).rejects.toThrow('Invalid authentication response')
    }
  })
})
