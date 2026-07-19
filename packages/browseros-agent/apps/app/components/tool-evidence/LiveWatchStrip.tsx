import { Globe } from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useLiveWatch } from './useLiveWatch'

export interface LiveWatchStripProps {
  pageId?: number
  enabled: boolean
  className?: string
}

/**
 * Compact live screencast strip for side-panel Agent mode while streaming.
 * Connects to agent-server `/screencast` via {@link useLiveWatch}.
 */
export const LiveWatchStrip: FC<LiveWatchStripProps> = ({
  pageId,
  enabled,
  className,
}) => {
  const watch = useLiveWatch(pageId, enabled)
  const incomingSrc =
    watch.jpegBase64 && watch.jpegBase64.length > 0
      ? `data:image/jpeg;base64,${watch.jpegBase64}`
      : null

  const [displayedSrc, setDisplayedSrc] = useState<string | null>(incomingSrc)

  useEffect(() => {
    if (incomingSrc === null) {
      setDisplayedSrc(null)
      return
    }
    if (incomingSrc === displayedSrc) return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setDisplayedSrc(incomingSrc)
    }
    img.src = incomingSrc
    return () => {
      cancelled = true
    }
  }, [incomingSrc, displayedSrc])

  if (!enabled) return null

  const label =
    watch.status === 'error'
      ? (watch.error ?? 'Watch unavailable')
      : watch.status === 'detached'
        ? 'Tab detached'
        : watch.url
          ? hostOf(watch.url)
          : watch.status === 'connected'
            ? 'Live'
            : 'Connecting…'

  return (
    <div
      className={cn(
        'border-border/40 border-b bg-background/70 px-3 py-2',
        className,
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              watch.status === 'connected' && watch.jpegBase64
                ? 'animate-pulse bg-emerald-500'
                : 'bg-muted-foreground/40',
            )}
          />
          <span className="truncate text-[11px] text-muted-foreground">
            Watching · {label}
          </span>
        </div>
        {pageId != null ? (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
            page {pageId}
          </span>
        ) : null}
      </div>
      <div className="relative flex h-[96px] items-center justify-center overflow-hidden bg-muted/25">
        {displayedSrc ? (
          <img
            src={displayedSrc}
            alt="Live agent view"
            className="h-full w-full object-cover object-top"
            onError={() => setDisplayedSrc(null)}
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <Globe className="size-5 opacity-60" />
            <span className="text-[11px]">{label}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
