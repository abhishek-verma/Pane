import type { FC } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ToolMedia } from '@/lib/tool-evidence/types'

function toSrc(media: ToolMedia): string {
  if (media.data.startsWith('data:')) return media.data
  return `data:${media.mimeType};base64,${media.data}`
}

export const ImageLightbox: FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  media: ToolMedia
  caption: string
  url?: string
}> = ({ open, onOpenChange, media, caption, url }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="text-sm">{caption}</DialogTitle>
      </DialogHeader>
      {url ? (
        <p className="truncate text-muted-foreground text-xs">{url}</p>
      ) : null}
      <img
        src={toSrc(media)}
        alt={caption}
        className="max-h-[70vh] w-full rounded-md object-contain"
      />
    </DialogContent>
  </Dialog>
)
