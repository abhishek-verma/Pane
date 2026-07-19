import { Globe } from 'lucide-react'
import { type FC, useEffect, useRef, useState } from 'react'
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
 * Uses a single blob URL (revoked on replace/unmount) instead of stacking
 * unique `data:` URLs per frame.
 */
export const LiveWatchStrip: FC<LiveWatchStripProps> = ({
  pageId,
  enabled,
  className,
}) => {
  const watch = useLiveWatch(pageId, enabled)
  const [blobSrc, setBlobSrc] = useState<string | null>(null)
  const blobSrcRef = useRef<string | null>(null)

  useEffect(() => {
    if (!watch.jpegBase64) {
      if (blobSrcRef.current) {
        URL.revokeObjectURL(blobSrcRef.current)
        blobSrcRef.current = null
      }
      setBlobSrc(null)
      return
    }

    let cancelled = false
    let objectUrl: string | null = null
    try {
      const binary = atob(watch.jpegBase64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
    } catch {
      return
    }

    const img = new Image()
    img.onload = () => {
      if (cancelled) {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        return
      }
      if (blobSrcRef.current) URL.revokeObjectURL(blobSrcRef.current)
      blobSrcRef.current = objectUrl
      setBlobSrc(objectUrl)
    }
    img.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    img.src = objectUrl

    return () => {
      cancelled = true
    }
  }, [watch.jpegBase64])

  useEffect(() => {
    return () => {
      if (blobSrcRef.current) {
        URL.revokeObjectURL(blobSrcRef.current)
        blobSrcRef.current = null
      }
    }
  }, [])

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
        {blobSrc ? (
          <img
            src={blobSrc}
            alt="Live agent view"
            className="h-full w-full object-cover object-top"
            onError={() => {
              if (blobSrcRef.current) {
                URL.revokeObjectURL(blobSrcRef.current)
                blobSrcRef.current = null
              }
              setBlobSrc(null)
            }}
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
