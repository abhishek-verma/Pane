import { type FC, useEffect, useState } from 'react'

export interface LiveStatusTemplateProps {
  status: string
  startedAt?: number
  url?: string
}

export const LiveStatusTemplate: FC<LiveStatusTemplateProps> = ({
  status,
  startedAt,
  url,
}) => {
  const [elapsed, setElapsed] = useState<string>('')

  useEffect(() => {
    if (!startedAt || status !== 'active') return
    const interval = setInterval(() => {
      const ms = Date.now() - startedAt
      const sec = Math.floor(ms / 1000) % 60
      const min = Math.floor(ms / 60_000) % 60
      const hr = Math.floor(ms / 3600_000)
      const parts = [
        hr > 0 ? String(hr) : null,
        String(min).padStart(2, '0'),
        String(sec).padStart(2, '0'),
      ].filter(Boolean)
      setElapsed(parts.join(':'))
    }, 1000)
    return () => clearInterval(interval)
  }, [startedAt, status])

  return (
    <div className="space-y-2.5 rounded-md border border-border/40 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
          </span>
          <span className="font-bold text-[10px] text-muted-foreground uppercase tracking-wider">
            Live Call
          </span>
        </div>
        {elapsed && (
          <span className="rounded border border-border/30 bg-background px-1.5 py-0.5 font-medium font-mono text-foreground text-xs">
            {elapsed}
          </span>
        )}
      </div>
      {url && (
        <p className="truncate rounded bg-background/50 p-1.5 font-mono text-muted-foreground text-xs">
          {url}
        </p>
      )}
    </div>
  )
}
