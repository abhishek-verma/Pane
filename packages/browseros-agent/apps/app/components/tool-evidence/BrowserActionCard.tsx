import { type FC, useState } from 'react'
import { agentTraceClass } from '@/lib/agent-chat/surfaces'
import { openActionLog } from '@/lib/tool-evidence/action-log-link'
import { useScreenshotPrefs } from '@/lib/tool-evidence/screenshot-prefs'
import type { ToolEvidence } from '@/lib/tool-evidence/types'
import { cn } from '@/lib/utils'
import { ImageLightbox } from './ImageLightbox'
import { ToolStatusIcon } from './ToolStatusIcon'

function toSrc(data: string, mimeType: string): string {
  if (data.startsWith('data:')) return data
  return `data:${mimeType};base64,${data}`
}

export const BrowserActionCard: FC<{
  evidence: ToolEvidence
  conversationId?: string
}> = ({ evidence, conversationId }) => {
  const [open, setOpen] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const { showBrowserScreenshots, blurScreenshotsUntilClick } =
    useScreenshotPrefs()
  const browser = evidence.browser
  if (!browser) return null
  const media = browser.media[0]
  const showImage = Boolean(media) && showBrowserScreenshots
  const blurred = showImage && blurScreenshotsUntilClick && !revealed

  const onThumbClick = () => {
    if (blurred) setRevealed(true)
    setOpen(true)
  }

  return (
    <>
      <div
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
        {showImage && media ? (
          <button
            type="button"
            className="mt-1.5 block w-full overflow-hidden"
            onClick={onThumbClick}
          >
            <img
              src={toSrc(media.data, media.mimeType)}
              alt={browser.caption}
              loading="lazy"
              className={cn(
                'aspect-video max-h-40 w-full object-cover object-top opacity-95 transition-[filter,opacity]',
                blurred && 'blur-md',
              )}
            />
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
      {showImage && media ? (
        <ImageLightbox
          open={open}
          onOpenChange={setOpen}
          media={media}
          caption={browser.caption}
          url={browser.url}
        />
      ) : null}
    </>
  )
}
