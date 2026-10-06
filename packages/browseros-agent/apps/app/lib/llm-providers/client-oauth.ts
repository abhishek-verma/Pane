/**
 * Client-side OAuth Device Code flow.
 * Used for providers where server-side fetch is blocked by WAF (e.g. Qwen).
 * The extension makes requests using Chrome's network stack which bypasses
 * TLS fingerprint-based WAF detection.
 */

import { waitForOAuthPoll } from './oauth-polling'

export interface ClientAuthConfig {
  deviceCodeEndpoint: string
  tokenEndpoint: string
  clientId: string
  scopes: string
  requiresPKCE: boolean
  contentType: 'json' | 'form'
}

export interface DeviceCodeData {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

export interface TokenResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export async function requestDeviceCode(
  auth: ClientAuthConfig,
  signal?: AbortSignal,
): Promise<{ deviceData: DeviceCodeData; codeVerifier?: string }> {
  let codeVerifier: string | undefined
  const params: Record<string, string> = {
    client_id: auth.clientId,
    scope: auth.scopes,
  }

  if (auth.requiresPKCE) {
    codeVerifier = generateCodeVerifier()
    params.code_challenge = await generateCodeChallenge(codeVerifier)
    params.code_challenge_method = 'S256'
  }

  const res = await authFetch(
    auth.deviceCodeEndpoint,
    params,
    auth.contentType,
    signal,
  )

  // WAF captcha detected — open the site for user to solve, then retry
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    const baseUrl = new URL(auth.deviceCodeEndpoint).origin
    await chrome.tabs.create({ url: baseUrl })
    throw new Error(
      'Please complete the verification in the opened tab, then try signing in again.',
    )
  }
  if (!res.ok) throw new Error(`Device code request failed: ${res.status}`)

  const deviceData = (await res.json()) as DeviceCodeData
  if (!deviceData.device_code || !deviceData.user_code) {
    throw new Error('Invalid device code response')
  }

  return { deviceData, codeVerifier }
}

export async function awaitDeviceToken(
  auth: ClientAuthConfig,
  deviceData: DeviceCodeData,
  codeVerifier: string | undefined,
  signal: AbortSignal,
  wait = waitForOAuthPoll,
): Promise<TokenResult> {
  let interval = Math.max(1, deviceData.interval || 5)
  const deadline = Date.now() + deviceData.expires_in * 1000
  while (Date.now() < deadline) {
    await wait((interval + 3) * 1000, signal)
    signal.throwIfAborted()
    if (Date.now() >= deadline) break
    const params: Record<string, string> = {
      client_id: auth.clientId,
      device_code: deviceData.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }
    if (codeVerifier) params.code_verifier = codeVerifier
    let res: Response
    try {
      res = await authFetch(
        auth.tokenEndpoint,
        params,
        auth.contentType,
        signal,
      )
    } catch {
      signal.throwIfAborted()
      // A transient network error can be retried while the device code is valid.
      continue
    }
    if (!res.headers.get('content-type')?.includes('application/json')) continue
    const data = (await res.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: string
      error_description?: string
      interval?: number
    }
    if (res.ok && data.access_token) {
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? '',
        expiresIn: data.expires_in ?? 0,
      }
    }
    if (data.error === 'authorization_pending') continue
    if (data.error === 'slow_down') {
      interval = Math.max(interval, data.interval ?? interval) + 5
      continue
    }
    throw new Error(
      data.error_description || data.error || `Sign-in failed (${res.status})`,
    )
  }
  throw new Error('Sign-in expired. Please try again.')
}

function authFetch(
  endpoint: string,
  params: Record<string, string>,
  contentType: 'json' | 'form',
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type':
        contentType === 'form'
          ? 'application/x-www-form-urlencoded'
          : 'application/json',
      Accept: 'application/json',
    },
    body:
      contentType === 'form'
        ? new URLSearchParams(params).toString()
        : JSON.stringify(params),
  })
}

function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64UrlEncode(bytes)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return base64UrlEncode(new Uint8Array(digest))
}

function base64UrlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
