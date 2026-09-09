import { Button } from '@/components/ui/button'

export interface LayerRunView {
  invocationId: string
  layerId: string
  version: string
  actionId: string
  provider: string
  status: string
  startedAt: number
  finishedAt: number | null
  name: string
}
export function LayerActivity({
  runs,
  disabled,
  stop,
}: {
  runs: LayerRunView[]
  disabled: boolean
  stop: (invocationId: string) => Promise<void>
}) {
  if (!runs.length) return null
  return (
    <details className="rounded-xl border p-4 text-sm">
      <summary className="cursor-pointer">Recent activity</summary>
      <p className="mt-2 text-muted-foreground">
        Run metadata is kept for up to seven days (at most 1,000 runs). Page
        text and responses are not saved here. Completed means the action result
        was accepted; the page may subsequently change or close.
      </p>
      <ol className="mt-3 max-h-72 space-y-3 overflow-auto">
        {runs.map((run) => (
          <li
            key={run.invocationId}
            className="flex items-start justify-between gap-3"
          >
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <p dir="auto">
                {run.name} · {run.actionId}
              </p>
              <p className="text-muted-foreground text-xs">
                {run.status} · {new Date(run.startedAt).toLocaleString()} ·{' '}
                {run.provider}
              </p>
            </div>
            {run.status === 'running' && (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                aria-label={`Stop ${run.name} · ${run.actionId}`}
                onClick={() => void stop(run.invocationId)}
              >
                Stop
              </Button>
            )}
          </li>
        ))}
      </ol>
    </details>
  )
}
