import type { FC } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export const ImageLightbox: FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  imgSrc: string
  mimeType: string
  caption: string
  url?: string
}> = ({ open, onOpenChange, imgSrc, caption, url }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="text-sm">{caption}</DialogTitle>
      </DialogHeader>
      {url ? (
        <p className="truncate text-muted-foreground text-xs">{url}</p>
      ) : null}
      <img
        src={imgSrc}
        alt={caption}
        className="max-h-[70vh] w-full rounded-md object-contain"
      />
    </DialogContent>
  </Dialog>
)
