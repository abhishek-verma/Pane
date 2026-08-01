import { type FC, useEffect, useRef, useState } from 'react'
import { agentTraceClass } from '@/lib/agent-chat/surfaces'
import { openActionLog } from '@/lib/tool-evidence/action-log-link'
import {
  shouldMountBrowserThumb,
  THUMB_ROOT_MARGIN,
} from '@/lib/tool-evidence/browser-thumb-mount'
import { useScreenshotPrefs } from '@/lib/tool-evidence/screenshot-prefs'
import { resolveToolImageBlobUrl } from '@/lib/tool-evidence/tool-image-url'
import { clearCachedToolImageBlobUrl } from '@/lib/tool-evidence/tool-media-cache'
import type { ToolEvidence } from '@/lib/tool-evidence/types'
import { cn } from '@/lib/utils'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'
import { ImageLightbox } from './ImageLightbox'
import { ToolStatusIcon } from './ToolStatusIcon'

function BrowserThumbFallback({
  pageDiffSummary,
  completed,
  showBrowserScreenshots,
}: {
  pageDiffSummary?: string
  completed: boolean
  showBrowserScreenshots: boolean
}) {
  if (pageDiffSummary) {
    return (
      <p className="mt-1 text-[11px] text-muted-foreground">
        {pageDiffSummary}
      </p>
    )
  }
  if (!completed) return null
  return (
    <p className="mt-1 text-[11px] text-muted-foreground">
      {showBrowserScreenshots
        ? 'Screenshot unavailable'
        : 'Screenshots hidden in settings'}
    </p>
  )
}

export const BrowserActionCard: FC<{
  evidence: ToolEvidence
  conversationId?: string
  /** Force-mount the thumb (e.g. step replay highlight) even if offscreen. */
  highlighted?: boolean
}> = ({ evidence, conversationId, highlighted = false }) => {
  const [open, setOpen] = useState(false)
  const [revealed, setRevealed] = useState(false)
  // Track which src failed so a new src/tool identity can retry automatically.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [nearViewport, setNearViewport] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const { showBrowserScreenshots, blurScreenshotsUntilClick } =
    useScreenshotPrefs()
  const { baseUrl: serverBaseUrl } = useAgentServerUrl()
  const browser = evidence.browser

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        setNearViewport(entry.isIntersecting)
      },
      { root: null, rootMargin: THUMB_ROOT_MARGIN, threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Never mount inline base64 / data: URLs — always profile-aware blob fetch.
  const media = browser?.media[0]
  const strippedMeta = browser?.strippedImages?.[0] ?? null
  const wantsScreenshot = Boolean(media || strippedMeta)
  const canFetch = Boolean(
    wantsScreenshot && serverBaseUrl && conversationId && evidence.toolCallId,
  )
  const hasImageSource = canFetch
  const imgMimeType = strippedMeta?.mimeType ?? media?.mimeType ?? 'image/png'

  const mountImage = shouldMountBrowserThumb({
    nearViewport,
    highlighted,
    hasImageSource,
    showBrowserScreenshots,
    imageFailed: false,
  })

  useEffect(() => {
    if (!mountImage || !canFetch) {
      setBlobUrl(null)
      if (evidence.toolCallId) {
        clearCachedToolImageBlobUrl(evidence.toolCallId)
      }
      return
    }
    if (!serverBaseUrl || !conversationId) return

    let cancelled = false
    const controller = new AbortController()
    setLoadFailed(false)

    void resolveToolImageBlobUrl({
      serverBaseUrl,
      conversationId,
      toolCallId: evidence.toolCallId,
      signal: controller.signal,
    })
      .then((url) => {
        if (cancelled || !url) return
        setBlobUrl(url)
      })
      .catch(() => {
        if (!cancelled) {
          setBlobUrl(null)
          setLoadFailed(true)
        }
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [mountImage, canFetch, serverBaseUrl, conversationId, evidence.toolCallId])

  const imgSrc = blobUrl ?? ''
  const imageFailed = loadFailed || (failedSrc != null && failedSrc === imgSrc)
  const showImageSlot =
    hasImageSource && showBrowserScreenshots && !imageFailed && !loadFailed
  const showMountedThumb = mountImage && Boolean(imgSrc) && !imageFailed
  const blurred = showMountedThumb && blurScreenshotsUntilClick && !revealed

  useEffect(() => {
    if (!showMountedThumb) setOpen(false)
  }, [showMountedThumb])

  const onThumbClick = () => {
    if (!showMountedThumb) return
    if (blurred) setRevealed(true)
    setOpen(true)
  }

  if (!browser) return null

  return (
    <>
      <div
        ref={cardRef}
        className={agentTraceClass(
          evidence.state === 'error' ? 'error' : 'browser',
        )}
      >
        <div className="flex items-center gap-2">
          <ToolStatusIcon state={evidence.state} />
          <span className="min-w-0 flex-1 truncate text-xs">
            {browser.caption}
          </span>
        </div>
        {evidence.errorText ? (
          <p className="mt-1 line-clamp-2 text-[11px] text-destructive">
            {evidence.errorText}
          </p>
        ) : null}
        {showImageSlot ? (
          <button
            type="button"
            className="mt-1.5 block w-full overflow-hidden"
            onClick={onThumbClick}
            disabled={!showMountedThumb}
          >
            {showMountedThumb ? (
              <img
                src={imgSrc}
                alt={browser.caption}
                loading="lazy"
                onError={() => setFailedSrc(imgSrc)}
                className={cn(
                  'aspect-video max-h-40 w-full object-cover object-top opacity-95 transition-[filter,opacity]',
                  blurred && 'blur-md',
                )}
              />
            ) : (
              <div
                aria-hidden
                className="aspect-video max-h-40 w-full bg-muted/40"
              />
            )}
            {blurred ? (
              <span className="mt-1 block text-center text-[10px] text-muted-foreground">
                Click to reveal
              </span>
            ) : null}
          </button>
        ) : (
          <BrowserThumbFallback
            pageDiffSummary={browser.pageDiffSummary}
            completed={evidence.state === 'completed'}
            showBrowserScreenshots={showBrowserScreenshots}
          />
        )}
        <div className="mt-1.5">
          <button
            type="button"
            className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => openActionLog(conversationId)}
          >
            View in Action Log
          </button>
        </div>
      </div>
      {showMountedThumb ? (
        <ImageLightbox
          open={open}
          onOpenChange={setOpen}
          imgSrc={imgSrc}
          mimeType={imgMimeType}
          caption={browser.caption}
          url={browser.url}
        />
      ) : null}
    </>
  )
}
