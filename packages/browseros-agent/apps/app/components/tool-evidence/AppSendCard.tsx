import type { FC } from 'react'
import { agentTraceClass } from '@/lib/agent-chat/surfaces'
import type { ToolEvidence } from '@/lib/tool-evidence/types'
import { ToolStatusIcon } from './ToolStatusIcon'

export const AppSendCard: FC<{ evidence: ToolEvidence }> = ({ evidence }) => {
  const appSend = evidence.appSend
  if (!appSend) return null

  return (
    <div
      className={agentTraceClass(
        evidence.state === 'error' ? 'error' : 'default',
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
