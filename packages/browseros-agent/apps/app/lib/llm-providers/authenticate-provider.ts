import { agentFetch } from '@/lib/browseros/agent-fetch'
import { awaitDeviceToken, requestDeviceCode } from './client-oauth'
import { waitForOAuthPoll } from './oauth-polling'
import type { OAuthProviderFlowConfig } from './oauth-providers'
import { requestServerOAuth } from './server-oauth'

export interface PendingDeviceCode {
  userCode: string
  providerName: string
  verificationUri: string
}

export interface AuthenticatedProvider {
  authenticated: true
  provider: string
  email?: string
  pending?: boolean
}

/** Shared by provider editing, quick setup, and onboarding. Never saves a provider draft. */
export async function authenticateProvider(
  config: OAuthProviderFlowConfig,
  serverUrl: string,
  options: {
    signal: AbortSignal
    onDeviceCode: (code: PendingDeviceCode) => void
    fetch?: typeof agentFetch
    openTab?: (url: string) => Promise<unknown>
    wait?: typeof waitForOAuthPoll
  },
): Promise<AuthenticatedProvider> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(300_000)])
  const fetchFn = options.fetch ?? agentFetch
  const openTab =
    options.openTab ?? ((url: string) => chrome.tabs.create({ url }))
  const wait = options.wait ?? waitForOAuthPoll
  const endpoint = `${serverUrl}/oauth/${encodeURIComponent(config.providerType)}`
  try {
    if (config.clientAuth) {
      const { deviceData, codeVerifier } = await requestDeviceCode(
        config.clientAuth,
        signal,
      )
      signal.throwIfAborted()
      const verificationUri =
        deviceData.verification_uri_complete ?? deviceData.verification_uri
      options.onDeviceCode({
        userCode: deviceData.user_code,
        providerName: config.displayName,
        verificationUri,
      })
      await openTab(verificationUri)
      const token = await awaitDeviceToken(
        config.clientAuth,
        deviceData,
        codeVerifier,
        signal,
        wait,
      )
      signal.throwIfAborted()
      const stored = await fetchFn(`${endpoint}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(token),
        signal,
      })
      if (!stored.ok)
        throw new Error(
          `Could not save ${config.displayName} sign-in (${stored.status}). Please try again.`,
        )
    } else {
      const result = await requestServerOAuth(
        serverUrl,
        config.providerType,
        fetchFn,
        signal,
      )
      signal.throwIfAborted()
      if ('authUrl' in result) {
        await openTab(result.authUrl)
      } else {
        options.onDeviceCode({ ...result, providerName: config.displayName })
        await openTab(result.verificationUri)
      }
    }
    while (true) {
      await wait(2_000, signal)
      signal.throwIfAborted()
      const response = await fetchFn(`${endpoint}/status`, { signal })
      if (!response.ok)
        throw new Error(
          `Could not check ${config.displayName} sign-in (${response.status}). Please try again.`,
        )
      const status = (await response.json()) as AuthenticatedProvider
      if (status.authenticated && !status.pending) return status
    }
  } catch (error) {
    if (signal.aborted && !options.signal.aborted)
      throw new Error('Sign-in timed out. Please try again.')
    throw error
  }
}
