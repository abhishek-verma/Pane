import type { FC } from 'react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ActionLogReplayButton } from './ActionLogReplayButton'
import { useActionLog } from './useActionLog'

const CONSEQUENCE_CLASSES = [
  'all',
  'write-local',
  'system',
  'write-external',
  'spend',
] as const

export const ActionLogPage: FC = () => {
  const [searchParams] = useSearchParams()
  const conversationId = searchParams.get('conversationId') ?? undefined
  const [classFilter, setClassFilter] = useState<string>('all')
  const { entries, loading, error, refetch } = useActionLog({
    consequenceClass: classFilter === 'all' ? undefined : classFilter,
    conversationId,
  })

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Action log</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Consequential agent actions recorded locally on this device.
            {conversationId
              ? ' Showing actions for the linked conversation.'
              : null}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-sm">Filter by class</span>
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONSEQUENCE_CLASSES.map((cls) => (
              <SelectItem key={cls} value={cls}>
                {cls === 'all' ? 'All classes' : cls}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && (
        <p className="text-muted-foreground text-sm">Loading action log…</p>
      )}
      {error && (
        <p className="text-destructive text-sm">
          {error instanceof Error ? error.message : 'Failed to load action log'}
        </p>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium text-sm">No actions recorded yet</p>
          <p className="mt-1 text-muted-foreground text-xs">
            When Pane writes files, runs commands, or takes other consequential
            actions on your behalf, each one is logged here with its approval
            status and consequence class.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-md border bg-card p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{entry.toolName}</div>
              <div className="text-muted-foreground text-xs">
                {new Date(entry.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded bg-muted px-2 py-0.5">
                {entry.consequenceClass}
              </span>
              <span className="rounded bg-muted px-2 py-0.5">
                {entry.decision}
              </span>
            </div>
            {entry.outputSummary && (
              <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-xs">
                {entry.outputSummary}
              </pre>
            )}
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Args
              </summary>
              <pre className="mt-1 overflow-auto rounded bg-muted/50 p-2">
                {entry.argsJson}
              </pre>
            </details>
            <ActionLogReplayButton entry={entry} />
          </li>
        ))}
      </ul>
    </div>
  )
}
