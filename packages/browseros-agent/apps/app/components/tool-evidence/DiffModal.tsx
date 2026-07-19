import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { FileChangeDetail } from '@/lib/tool-evidence/types'
import { DiffLines } from './DiffLines'

export const DiffModal: FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  file: FileChangeDetail
}> = ({ open, onOpenChange, file }) => {
  const copyDiff = () => {
    void navigator.clipboard.writeText(file.diffLines.join('\n'))
  }
  const copyPath = () => {
    void navigator.clipboard.writeText(file.path)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="truncate font-mono text-sm">
            {file.path}
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={copyPath}>
            Copy path
          </Button>
          {!file.omitFullContent && file.diffLines.length > 0 ? (
            <Button size="sm" variant="outline" onClick={copyDiff}>
              Copy diff
            </Button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30">
          {file.omitFullContent ? (
            <p className="p-3 text-muted-foreground text-sm">
              {file.omitReason ?? 'Full content omitted'}
            </p>
          ) : file.diffLines.length === 0 ? (
            <p className="p-3 text-muted-foreground text-sm">
              No textual change
            </p>
          ) : (
            <DiffLines lines={file.diffLines} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
