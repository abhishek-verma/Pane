import { describe, expect, it, mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  OAUTH_PROVIDERS_CONFIG,
  type OAuthProviderType,
} from '@/lib/llm-providers/oauth-providers'

let state = {
  status: null as { authenticated: boolean; email?: string } | null,
  isPending: false,
  error: undefined as string | undefined,
  pendingDeviceCode: null as {
    userCode: string
    verificationUri: string
  } | null,
}
mock.module('@/modules/llm-providers/provider-authentication.hooks', () => ({
  useProviderAuthentication: () => ({
    ...state,
    start: async () => {},
    cancel() {},
  }),
}))
const { ProviderSignIn } = await import('./ProviderSignIn')
function render(
  providerType: OAuthProviderType,
  serverUrl: string | undefined = 'http://localhost:9100',
) {
  return renderToStaticMarkup(
    createElement(ProviderSignIn, {
      providerType,
      serverUrl,
      onAuthenticated() {},
    }),
  )
}
describe('all OAuth provider editors', () => {
  for (const type of Object.keys(
    OAUTH_PROVIDERS_CONFIG,
  ) as OAuthProviderType[]) {
    it(`${type}: offers login, progress, cancellation, and reconnect`, () => {
      state = {
        status: null,
        isPending: false,
        error: undefined,
        pendingDeviceCode: null,
      }
      expect(render(type)).toContain(
        `Sign in to ${OAUTH_PROVIDERS_CONFIG[type].displayName}`,
      )
      state.isPending = true
      expect(render(type)).toContain('Cancel sign-in')
      expect(render(type)).toContain('disabled=""')
      state.isPending = false
      state.status = { authenticated: true, email: 'user@example.test' }
      expect(render(type)).toContain('Sign in again')
      expect(render(type)).toContain('user@example.test')
    })
  }
  it('shows the device code and verification link', () => {
    state = {
      status: null,
      isPending: true,
      error: undefined,
      pendingDeviceCode: {
        userCode: 'ABCD',
        verificationUri: 'https://example.test/device',
      },
    }
    const html = render('qwen-code')
    expect(html).toContain('ABCD')
    expect(html).toContain('https://example.test/device')
  })
  it('surfaces failures and unavailable servers', () => {
    state = {
      status: null,
      isPending: false,
      error: 'Sign-in expired',
      pendingDeviceCode: null,
    }
    const html = renderToStaticMarkup(
      createElement(ProviderSignIn, {
        providerType: 'github-copilot',
        onAuthenticated() {},
      }),
    )
    expect(html).toContain('Waiting for the Pane server')
    expect(html).toContain('Sign-in expired')
    expect(html).toContain('disabled=""')
  })
})
