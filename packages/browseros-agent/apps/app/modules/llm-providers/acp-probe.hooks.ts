import { useQuery } from '@tanstack/react-query'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { withRequestDeadline } from '@/lib/browseros/request-deadline'
import type { ProviderType } from '@/lib/llm-providers/types'
import { useAgentServerUrl } from '../browseros/agent-server-url.hooks'

interface AcpProbeModel {
  id: string
  name?: string
  description?: string
}

interface AcpProbeReasoning {
  values: string[]
  defaultValue?: string
}

interface AcpProbeError {
  code: string
  message: string
}

interface AcpProbeResult {
  models: AcpProbeModel[]
  reasoning: AcpProbeReasoning | null
  supportsConfigOption: boolean
  agentInfo: { name?: string; title?: string; version?: string } | null
  protocolVersion: number
  error?: AcpProbeError
}

export interface UseAcpProbeOptions {
  providerType: ProviderType | undefined
  acpAgentId?: string
  command?: string
  cwd?: string
  enabled?: boolean
}

const BUILT_IN_AGENT_BY_TYPE: Partial<Record<ProviderType, string>> = {
  'claude-code': 'claude',
  codex: 'codex',
}

// Probe results encode the agent's currently-installed CLI version, which
// can change underfoot (npm install, codex-acp release). Refetch on every
// dialog open instead of trusting a stale memory cache.
const PROBE_STALE_TIME_MS = 0

export function resolveAcpAgentId(
  opts: UseAcpProbeOptions,
): string | undefined {
  if (opts.acpAgentId) return opts.acpAgentId
  if (!opts.providerType) return undefined
  return BUILT_IN_AGENT_BY_TYPE[opts.providerType]
}

export function isAcpProbeEnabled(
  opts: UseAcpProbeOptions,
  agentServerUrl: string | undefined,
  agentId: string | undefined,
): boolean {
  if (!(opts.enabled ?? true)) return false
  if (!agentServerUrl) return false
  if (!opts.providerType) return false
  if (opts.providerType === 'acp-custom') {
    return Boolean(opts.command) && Boolean(agentId)
  }
  return Boolean(agentId)
}

export async function fetchAcpProbe(
  serverUrl: string,
  input: { agentId?: string; command?: string; cwd?: string },
  signal?: AbortSignal,
  request: typeof agentFetch = agentFetch,
): Promise<AcpProbeResult> {
  return withRequestDeadline(
    async (requestSignal) => {
      const res = await request(`${serverUrl}/acpx/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: requestSignal,
      })
      const body = (await res.json()) as AcpProbeResult
      if (!res.ok || body.error) {
        const error = body.error as AcpProbeError | string | undefined
        throw new Error(
          typeof error === 'string'
            ? error
            : (error?.message ?? 'Could not load models. Try again.'),
        )
      }
      return body
    },
    { signal, timeoutMs: 125_000 },
  )
}

export function useAcpProbe(opts: UseAcpProbeOptions) {
  const { baseUrl: agentServerUrl } = useAgentServerUrl()
  const agentId = resolveAcpAgentId(opts)
  const enabled = isAcpProbeEnabled(opts, agentServerUrl ?? undefined, agentId)

  return useQuery<AcpProbeResult>({
    queryKey: [
      'acpx-probe',
      agentServerUrl,
      opts.providerType,
      agentId,
      opts.command,
      opts.cwd,
    ],
    enabled,
    staleTime: PROBE_STALE_TIME_MS,
    retry: false,
    queryFn: ({ signal }) =>
      fetchAcpProbe(
        agentServerUrl as string,
        { agentId, command: opts.command, cwd: opts.cwd },
        signal,
      ),
  })
}
