import type { FC } from 'react'
import { DIFF_MODAL_SOFT_CAP_LINES } from '@/lib/tool-evidence/types'
import { cn } from '@/lib/utils'

export const DiffLines: FC<{
  lines: string[]
  maxLines?: number
  className?: string
}> = ({ lines, maxLines = DIFF_MODAL_SOFT_CAP_LINES, className }) => {
  const visible = lines.slice(0, maxLines)
  const truncated = lines.length > maxLines
  return (
    <pre
      className={cn(
        'min-w-0 max-w-full overflow-x-auto font-mono text-[11px] leading-4',
        className,
      )}
    >
      {visible.map((line, i) => {
        const isAdd = line.startsWith('+') && !line.startsWith('+++')
        const isDel = line.startsWith('-') && !line.startsWith('---')
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: stable diff order
            key={i}
            className={cn(
              'whitespace-pre-wrap break-all px-1',
              isAdd && 'bg-signal/10 text-signal',
              isDel && 'bg-destructive/10 text-destructive',
              !isAdd && !isDel && 'text-muted-foreground',
            )}
          >
            {line}
          </div>
        )
      })}
      {truncated ? (
        <div className="px-1 text-muted-foreground">
          … {lines.length - maxLines} more lines
        </div>
      ) : null}
    </pre>
  )
}
