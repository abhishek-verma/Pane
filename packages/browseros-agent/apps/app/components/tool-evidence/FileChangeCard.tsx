import { type FC, useState } from 'react'
import { formatFileStats } from '@/lib/tool-evidence/file-evidence'
import { DIFF_PEEK_LINES, type ToolEvidence } from '@/lib/tool-evidence/types'
import { cn } from '@/lib/utils'
import { DiffLines } from './DiffLines'
import { DiffModal } from './DiffModal'
import { ToolStatusIcon } from './ToolStatusIcon'

export const FileChangeCard: FC<{ evidence: ToolEvidence }> = ({
  evidence,
}) => {
  const [open, setOpen] = useState(false)
  const file = evidence.file
  if (!file) return null

  const stats = formatFileStats(file)
  const peek = file.diffLines.slice(0, DIFF_PEEK_LINES)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'w-full rounded-md border border-border/60 bg-card/40 px-2.5 py-2 text-left transition-colors hover:bg-accent/40',
          evidence.state === 'error' && 'border-destructive/40',
        )}
      >
        <div className="flex items-center gap-2">
          <ToolStatusIcon state={evidence.state} />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {file.path}
          </span>
          {stats ? (
            <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
              {stats}
            </span>
          ) : null}
        </div>
        {evidence.errorText ? (
          <p className="mt-1 line-clamp-2 text-[11px] text-destructive">
            {evidence.errorText}
          </p>
        ) : null}
        {peek.length > 0 ? (
          <div className="relative mt-1.5 max-h-[7.5rem] overflow-hidden rounded bg-muted/40">
            <DiffLines lines={peek} maxLines={DIFF_PEEK_LINES} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent" />
          </div>
        ) : null}
      </button>
      <DiffModal open={open} onOpenChange={setOpen} file={file} />
    </>
  )
}
