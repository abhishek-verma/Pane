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
        'overflow-x-auto font-mono text-[11px] leading-4',
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
              isAdd &&
                'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
              isDel && 'bg-red-500/10 text-red-700 dark:text-red-400',
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
