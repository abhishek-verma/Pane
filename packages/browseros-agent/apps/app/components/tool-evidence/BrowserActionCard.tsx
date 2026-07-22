import { type FC, useEffect, useRef, useState } from 'react'
import { agentTraceClass } from '@/lib/agent-chat/surfaces'
import { openActionLog } from '@/lib/tool-evidence/action-log-link'
import {
  shouldMountBrowserThumb,
  THUMB_ROOT_MARGIN,
} from '@/lib/tool-evidence/browser-thumb-mount'
import { useScreenshotPrefs } from '@/lib/tool-evidence/screenshot-prefs'
import type { ToolEvidence } from '@/lib/tool-evidence/types'
import { cn } from '@/lib/utils'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'
import { ImageLightbox } from './ImageLightbox'
import { ToolStatusIcon } from './ToolStatusIcon'

function toSrc(data: string, mimeType: string): string {
  if (data.startsWith('data:')) return data
  return `data:${mimeType};base64,${data}`
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

  const media = browser?.media[0]
  // If no inline image but the server stripped one, build a lazy-load URL.
  const strippedMeta =
    browser && !media ? (browser.strippedImages?.[0] ?? null) : null
  const strippedSrc =
    strippedMeta && serverBaseUrl && conversationId
      ? `${serverBaseUrl}/chat/${conversationId}/tool-images/${evidence.toolCallId}`
      : null

  const imgSrc = media ? toSrc(media.data, media.mimeType) : (strippedSrc ?? '')
  const imgMimeType = media?.mimeType ?? strippedMeta?.mimeType ?? 'image/png'
  const imageFailed = failedSrc != null && failedSrc === imgSrc
  const hasImageSource = Boolean(media || strippedSrc)
  const showImageSlot = hasImageSource && showBrowserScreenshots && !imageFailed
  // Only decode the bitmap when near the viewport (or force-mounted for replay).
  const mountImage = shouldMountBrowserThumb({
    nearViewport,
    highlighted,
    hasImageSource,
    showBrowserScreenshots,
    imageFailed,
  })
  const blurred = mountImage && blurScreenshotsUntilClick && !revealed

  // Close the lightbox when the thumb demounts so it does not reopen on remount.
  useEffect(() => {
    if (!mountImage) setOpen(false)
  }, [mountImage])

  const onThumbClick = () => {
    if (!mountImage) return
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
            disabled={!mountImage}
          >
            {mountImage ? (
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
              // Reserved box keeps layout stable while the bitmap is demounted.
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
        ) : browser.pageDiffSummary ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {browser.pageDiffSummary}
          </p>
        ) : evidence.state === 'completed' ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {showBrowserScreenshots
              ? 'Screenshot unavailable'
              : 'Screenshots hidden in settings'}
          </p>
        ) : null}
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
      {mountImage ? (
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
