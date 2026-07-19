import type { FC } from 'react'
import type { ToolEvidence } from '@/lib/tool-evidence/types'
import { cn } from '@/lib/utils'
import { ToolStatusIcon } from './ToolStatusIcon'

export const AppSendCard: FC<{ evidence: ToolEvidence }> = ({ evidence }) => {
  const appSend = evidence.appSend
  if (!appSend) return null

  return (
    <div
      className={cn(
        'w-full rounded-md border border-border/60 bg-card/40 px-2.5 py-2',
        evidence.state === 'error' && 'border-destructive/40',
      )}
    >
      <div className="flex items-center gap-2">
        <ToolStatusIcon state={evidence.state} />
        <span className="min-w-0 flex-1 truncate text-xs">{appSend.title}</span>
      </div>
      {appSend.destination ? (
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          → {appSend.destination}
        </p>
      ) : null}
      {evidence.errorText ? (
        <p className="mt-1 line-clamp-2 text-[11px] text-destructive">
          {evidence.errorText}
        </p>
      ) : appSend.summary ? (
        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
          {appSend.summary}
        </p>
      ) : null}
    </div>
  )
}
