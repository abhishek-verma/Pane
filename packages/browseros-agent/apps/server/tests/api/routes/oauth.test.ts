import { describe, expect, it, mock } from 'bun:test'
import { createOAuthRoutes } from '../../../src/api/routes/oauth'
import type { OAuthTokenManager } from '../../../src/lib/clients/oauth/token-manager'

function setup(error?: Error) {
  const generateAuthorizationUrl = mock(async () => {
    if (error) throw error
    return 'https://auth.example/authorize?state=test'
  })
  const startDeviceCodeFlow = mock(async () => ({
    userCode: 'ABCD',
    verificationUri: 'https://auth.example/device',
    expiresIn: 900,
  }))
  const app = createOAuthRoutes({
    tokenManager: {
      generateAuthorizationUrl,
      startDeviceCodeFlow,
    } as unknown as OAuthTokenManager,
  })
  return { app, generateAuthorizationUrl, startDeviceCodeFlow }
}

describe('OAuth start', () => {
  it('returns a JSON authorization URL to the extension', async () => {
    const { app, generateAuthorizationUrl } = setup()
    const response = await app.request('/chatgpt-pro/start?format=json')
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.json()).toEqual({
      authUrl: 'https://auth.example/authorize?state=test',
    })
    expect(generateAuthorizationUrl).toHaveBeenCalledWith(
      'chatgpt-pro',
      undefined,
    )
  })
  it('preserves direct browser redirects', async () => {
    const { app } = setup()
    const response = await app.request('/chatgpt-pro/start')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'https://auth.example/authorize?state=test',
    )
  })
  it('preserves device-code flows with JSON negotiation', async () => {
    const { app, generateAuthorizationUrl, startDeviceCodeFlow } = setup()
    const response = await app.request('/github-copilot/start?format=json')
    expect(await response.json()).toEqual({
      userCode: 'ABCD',
      verificationUri: 'https://auth.example/device',
      expiresIn: 900,
    })
    expect(startDeviceCodeFlow).toHaveBeenCalledWith('github-copilot')
    expect(generateAuthorizationUrl).not.toHaveBeenCalled()
  })
  it('returns callback failures for display in the editor', async () => {
    const { app } = setup(new Error('OAuth callback port is in use'))
    const response = await app.request('/chatgpt-pro/start?format=json')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'OAuth callback port is in use',
    })
  })
})
