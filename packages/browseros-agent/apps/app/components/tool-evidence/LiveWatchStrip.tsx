import { Globe } from 'lucide-react'
import type { FC } from 'react'
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
 *
 * The hook owns a single blob URL (revoked on replace/unmount) so this
 * strip never stacks `data:` URLs or keeps base64 in React state.
 */
export const LiveWatchStrip: FC<LiveWatchStripProps> = ({
  pageId,
  enabled,
  className,
}) => {
  const watch = useLiveWatch(pageId, enabled)

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
              watch.status === 'connected' && watch.blobUrl
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
