import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  Bell,
  CheckCircle2,
  Clock,
  Loader2,
  RadioTower,
  Sparkles,
  XCircle,
} from 'lucide-react'
import type { FC } from 'react'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

dayjs.extend(relativeTime)

interface ScheduledRun {
  id: string
  source: string
  sourceId: string | null
  prompt: string
  status:
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'skipped'
    | 'cancelled'
    | 'awaiting-approval'
  result: string | null
  error: string | null
  startedAt: number | null
  completedAt: number | null
  createdAt: number
}

const RUNS_KEY = ['scheduler', 'runs'] as const

async function fetchRuns(): Promise<ScheduledRun[]> {
  const base = await getAgentServerUrl()
  const res = await agentFetch(`${base}/scheduler/runs`)
  if (!res.ok) throw new Error(`Failed to load automation runs: ${res.status}`)
  const data = (await res.json()) as { runs: ScheduledRun[] }
  return data.runs
}

const SOURCE_LABELS: Record<string, string> = {
  'pi-harvest': 'PI harvest',
  'pi-materialize': 'PI update',
  trigger: 'Trigger',
  digest: 'Digest',
  keepalive: 'Keep-alive',
  manual: 'Manual',
  schedule: 'Scheduled task',
}

const SOURCE_ICONS: Record<string, FC<{ className?: string }>> = {
  'pi-harvest': Sparkles,
  'pi-materialize': Sparkles,
  trigger: RadioTower,
  digest: Bell,
  keepalive: Clock,
}

const getStatusIcon = (status: ScheduledRun['status']) => {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin text-accent-orange" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-destructive" />
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />
  }
}

const formatTimestamp = (epochMs: number | null) =>
  epochMs ? dayjs(epochMs).fromNow() : null

export const AutomationsPanel: FC = () => {
  const {
    data: runs = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: RUNS_KEY,
    queryFn: fetchRuns,
    refetchInterval: 5_000,
  })

  if (isLoading) {
    return (
      <p className="py-8 text-center text-muted-foreground text-sm">Loading…</p>
    )
  }

  if (error) {
    return (
      <p className="py-8 text-center text-destructive text-sm">
        Failed to load automation runs.
      </p>
    )
  }

  if (!runs.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <RadioTower className="h-10 w-10 opacity-50" />
        <p className="text-sm">No automation runs yet</p>
        <p className="max-w-xs text-center text-xs">
          Background work from PI, triggers, and digests will show up here once
          it runs.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const SourceIcon = SOURCE_ICONS[run.source]
        const timestamp = formatTimestamp(run.startedAt ?? run.createdAt)
        return (
          <div
            key={run.id}
            className="rounded-md border border-border/50 bg-card p-4"
          >
            <div className="flex items-start gap-3">
              {getStatusIcon(run.status)}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  {SourceIcon ? (
                    <SourceIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : null}
                  <span className="font-medium text-foreground text-sm">
                    {SOURCE_LABELS[run.source] ?? run.source}
                  </span>
                  <span className="text-muted-foreground text-xs capitalize">
                    {run.status}
                  </span>
                  {timestamp ? (
                    <span className="flex items-center gap-1 text-muted-foreground text-xs">
                      <Clock className="h-3 w-3" />
                      {timestamp}
                    </span>
                  ) : null}
                </div>
                <p className="line-clamp-2 text-ellipsis text-muted-foreground text-xs">
                  {run.prompt}
                </p>
                {run.status === 'failed' && run.error ? (
                  <p className="mt-1 line-clamp-2 text-destructive text-xs">
                    {run.error}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
