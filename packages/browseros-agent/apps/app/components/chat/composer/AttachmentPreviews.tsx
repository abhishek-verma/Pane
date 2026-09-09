import { FileText, X } from 'lucide-react'
import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { StagedAttachment } from '@/lib/attachments'

export function AttachmentPreviews({
  attachments,
  onRemove,
}: {
  attachments: StagedAttachment[]
  onRemove?: (id: string) => void
}) {
  const [preview, setPreview] = useState<StagedAttachment>()
  if (!attachments.length) return null
  return (
    <>
      <div className="flex flex-wrap gap-2 px-1 py-2">
        {attachments.map((item) => (
          <div
            key={item.id}
            className="group relative max-w-52 rounded-xl border border-border/60 bg-background"
          >
            <button
              type="button"
              onClick={() => setPreview(item)}
              title={`Preview ${item.name}`}
              className="flex h-16 items-center gap-2 overflow-hidden rounded-xl px-2 text-left"
            >
              {item.kind === 'image' ? (
                <img
                  className="h-12 w-16 rounded-md object-cover"
                  src={item.dataUrl}
                  alt={item.name}
                />
              ) : (
                <FileText className="size-6 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0">
                <span className="block truncate font-medium text-xs">
                  {item.name}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {item.kind === 'image'
                    ? 'Image'
                    : item.mediaType === 'application/pdf'
                      ? 'PDF · original attached'
                      : 'Text ready'}
                </span>
              </span>
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                aria-label={`Remove ${item.name}`}
                className="absolute -top-1 -right-1 rounded-full border bg-background p-1 hover:bg-muted"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}
      </div>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => !open && setPreview(undefined)}
      >
        <DialogContent className="max-w-2xl">
          <DialogTitle>{preview?.name}</DialogTitle>
          {preview?.kind === 'image' ? (
            <img
              className="max-h-[65vh] w-full object-contain"
              src={preview.dataUrl}
              alt={preview.name}
            />
          ) : preview?.payload.kind === 'file' ? (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 text-xs">
              {preview.payload.text}
            </pre>
          ) : (
            <p className="text-muted-foreground text-sm">
              The original PDF is attached. Reading its text and visual pages
              depends on the selected model. Encrypted files may need to be
              unlocked first.
            </p>
          )}
          {preview?.dataUrl && (
            <a
              href={preview.dataUrl}
              download={preview.name}
              className="text-sm underline"
            >
              Download original
            </a>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
