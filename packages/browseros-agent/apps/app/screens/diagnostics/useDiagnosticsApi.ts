import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'

export interface DiagnosticsData {
  serverHealth: {
    running: boolean
    port: number
    startedAt: string
    uptimeMs: number
    platform: string
    pid: number
  }
  cdpStatus: {
    connected: boolean
  }
  diskUsage: {
    total: number
    breakdown: Record<string, number>
    error?: string
  }
  captureState: {
    consents: Array<{ domain: string; meeting: boolean; browsing: boolean }>
    diskUsed: number
  }
  reachStatus: {
    transports: Array<{ type: string; configured: boolean }>
  }
  keepAliveStatus: {
    platform: string
    installed: boolean
    implemented: boolean
    plistPath?: string | null
    limitations?: string[]
  }
  actionLogSummary: {
    approved: number
    denied: number
    replayed: number
    total: number
  }
  dataDir: string
}

const DIAGNOSTICS_KEY = ['diagnostics'] as const

export function useDiagnostics() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  return useQuery<DiagnosticsData>({
    queryKey: DIAGNOSTICS_KEY,
    queryFn: async () => {
      const res = await fetch(`${baseUrl}/diagnostics`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled: !urlLoading && !!baseUrl,
    refetchInterval: 10_000,
  })
}

export function useDiagnosticsLogs() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  return useQuery<{ lines: string[]; file?: string; error?: string }>({
    queryKey: ['diagnostics-logs'],
    queryFn: async () => {
      const res = await fetch(`${baseUrl}/diagnostics/logs?lines=200`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled: !urlLoading && !!baseUrl,
    refetchInterval: 5_000,
  })
}

export function useWipeContextIndex() {
  const { baseUrl } = useAgentServerUrl()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${baseUrl}/diagnostics/wipe-context-index`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: DIAGNOSTICS_KEY }),
  })
}

export function useTestProvider() {
  const { baseUrl } = useAgentServerUrl()
  return useMutation({
    mutationFn: async (providerId: string) => {
      const res = await fetch(`${baseUrl}/diagnostics/test-provider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<{ ok: boolean; error?: string }>
    },
  })
}
