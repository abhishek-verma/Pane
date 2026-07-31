import { Globe } from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import { isLiveWatchSparse } from '@/lib/tool-evidence/live-watch-frame'
import { cn } from '@/lib/utils'
import { type LiveWatchState, useLiveWatch } from './useLiveWatch'

export interface LiveWatchStripProps {
  pageId?: number
  enabled: boolean
  className?: string
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function liveWatchLabel(watch: LiveWatchState, sparse: boolean): string {
  if (watch.status === 'error') return watch.error ?? 'Watch unavailable'
  if (watch.status === 'detached') return 'Tab detached'
  const host = watch.url ? hostOf(watch.url) : null
  if (sparse && watch.status === 'connected') {
    return host
      ? `Background tab · ${host}`
      : 'Background tab · waiting for frames'
  }
  if (host) return host
  if (watch.status === 'connected') return 'Live'
  return 'Connecting…'
}

function liveWatchDotClass(args: {
  status: LiveWatchState['status']
  hasBlob: boolean
  sparse: boolean
}): string {
  if (args.status === 'connected' && args.hasBlob && !args.sparse) {
    return 'animate-pulse bg-emerald-500'
  }
  if (args.status === 'connected' && args.sparse) return 'bg-amber-500/80'
  return 'bg-muted-foreground/40'
}

/**
 * Compact live screencast strip for side-panel Agent mode while streaming.
 * Connects to agent-server `/screencast` via {@link useLiveWatch}.
 *
 * The hook owns a single blob URL (revoked on replace/unmount) so this
 * strip never stacks `data:` URLs or keeps base64 in React state.
 * When the agent tab is backgrounded (no bringToFront), frames may be
 * sparse — we surface that instead of looking broken.
 */
export const LiveWatchStrip: FC<LiveWatchStripProps> = ({
  pageId,
  enabled,
  className,
}) => {
  const watch = useLiveWatch(pageId, enabled)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled || watch.status !== 'connected') return
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [enabled, watch.status])

  if (!enabled) return null

  const sparse = isLiveWatchSparse({
    status: watch.status,
    hasBlob: Boolean(watch.blobUrl),
    lastFrameAt: watch.lastFrameAt ?? null,
    now,
  })
  const label = liveWatchLabel(watch, sparse)

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
              liveWatchDotClass({
                status: watch.status,
                hasBlob: Boolean(watch.blobUrl),
                sparse,
              }),
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
        {watch.blobUrl ? (
          <img
            src={watch.blobUrl}
            alt="Live agent view"
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <Globe className="size-5 opacity-60" />
            <span className="text-[11px]">{label}</span>
          </div>
        )}
      </div>
      {sparse && watch.blobUrl ? (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Agent tab is in the background — frames may be sparse until you switch
          to it.
        </p>
      ) : null}
    </div>
  )
}
