import { useQuery, useQueryClient } from '@tanstack/react-query'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

export interface OAuthStatus {
  authenticated: boolean
  email?: string
  provider: string
}

const oauthStatusKey = (provider: string) => ['provider-oauth-status', provider]

export function useOAuthStatus(provider: string) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: oauthStatusKey(provider),
    staleTime: 0,
    retry: 1,
    queryFn: async ({ signal }): Promise<OAuthStatus> => {
      const serverUrl = await getAgentServerUrl()
      const res = await agentFetch(`${serverUrl}/oauth/${provider}/status`, {
        signal,
      })
      if (!res.ok) throw new Error(`Could not check sign-in (${res.status})`)
      return res.json()
    },
  })

  async function disconnect() {
    const serverUrl = await getAgentServerUrl()
    const response = await agentFetch(`${serverUrl}/oauth/${provider}`, {
      method: 'DELETE',
    })
    if (!response.ok)
      throw new Error(`Could not disconnect (${response.status})`)
    queryClient.setQueryData(oauthStatusKey(provider), {
      authenticated: false,
      provider,
    })
  }

  return {
    status: query.data ?? null,
    refresh: async () => (await query.refetch()).data ?? null,
    disconnect,
  }
}
