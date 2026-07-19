import { type FC, useState } from 'react'
import type { ToolEvidence } from '@/lib/tool-evidence/types'
import { cn } from '@/lib/utils'
import { ImageLightbox } from './ImageLightbox'
import { ToolStatusIcon } from './ToolStatusIcon'

function toSrc(data: string, mimeType: string): string {
  if (data.startsWith('data:')) return data
  return `data:${mimeType};base64,${data}`
}

export const BrowserActionCard: FC<{ evidence: ToolEvidence }> = ({
  evidence,
}) => {
  const [open, setOpen] = useState(false)
  const browser = evidence.browser
  if (!browser) return null
  const media = browser.media[0]

  return (
    <>
      <div
        className={cn(
          'w-full rounded-md border border-border/60 bg-card/40 px-2.5 py-2',
          evidence.state === 'error' && 'border-destructive/40',
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
        {media ? (
          <button
            type="button"
            className="mt-1.5 block w-full overflow-hidden rounded"
            onClick={() => setOpen(true)}
          >
            <img
              src={toSrc(media.data, media.mimeType)}
              alt={browser.caption}
              loading="lazy"
              className="aspect-video max-h-40 w-full object-cover object-top"
            />
          </button>
        ) : browser.pageDiffSummary ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {browser.pageDiffSummary}
          </p>
        ) : evidence.state === 'completed' ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Screenshot unavailable
          </p>
        ) : null}
      </div>
      {media ? (
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
