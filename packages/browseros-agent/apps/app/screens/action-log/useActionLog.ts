import { useQuery } from '@tanstack/react-query'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'

export interface ActionLogEntry {
  id: string
  runId: string
  conversationId: string
  toolName: string
  argsJson: string
  consequenceClass: string
  decision: string
  outputSummary: string | null
  createdAt: number
}

const ACTION_LOG_QUERY_KEY = 'action-log'

async function fetchActionLog(
  baseUrl: string,
  filters: {
    conversationId?: string
    consequenceClass?: string
  },
): Promise<ActionLogEntry[]> {
  const params = new URLSearchParams()
  if (filters.conversationId) {
    params.set('conversationId', filters.conversationId)
  }
  if (filters.consequenceClass) {
    params.set('consequenceClass', filters.consequenceClass)
  }
  const query = params.toString()
  const res = await fetch(
    `${baseUrl.replace(/\/$/, '')}/action-log${query ? `?${query}` : ''}`,
  )
  if (!res.ok) {
    throw new Error(`Failed to load action log (${res.status})`)
  }
  const body = (await res.json()) as { entries: ActionLogEntry[] }
  return body.entries ?? []
}

export function useActionLog(
  filters: { conversationId?: string; consequenceClass?: string } = {},
) {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()

  const query = useQuery({
    queryKey: [ACTION_LOG_QUERY_KEY, baseUrl, filters],
    queryFn: () => fetchActionLog(baseUrl as string, filters),
    enabled: Boolean(baseUrl) && !urlLoading,
  })

  return {
    entries: query.data ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error,
    refetch: query.refetch,
  }
}
