import { agentFetch } from '@/lib/browseros/agent-fetch'

export async function requestServerOAuth(
  serverUrl: string,
  provider: string,
  fetchFn: typeof agentFetch = agentFetch,
  signal?: AbortSignal,
): Promise<
  { authUrl: string } | { userCode: string; verificationUri: string }
> {
  const response = await fetchFn(
    `${serverUrl}/oauth/${encodeURIComponent(provider)}/start?format=json`,
    { redirect: 'error', ...(signal ? { signal } : {}) },
  )
  const data = (await response.json().catch(() => null)) ?? {}
  if (!response.ok || data.error) {
    throw new Error(data.error || `Authentication failed (${response.status})`)
  }
  if (typeof data.authUrl === 'string' && data.authUrl) {
    return { authUrl: data.authUrl }
  }
  if (
    typeof data.userCode === 'string' &&
    typeof data.verificationUri === 'string'
  ) {
    return { userCode: data.userCode, verificationUri: data.verificationUri }
  }
  throw new Error('Invalid authentication response from server')
}
