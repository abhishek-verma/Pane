import type { FC } from 'react'
import { cn } from '@/lib/utils'

/** Wordmark: Pane + small square as the full stop. */
export const PaneWordmark: FC<{ className?: string }> = ({ className }) => (
  <span
    className={cn(
      'inline-flex flex-nowrap items-end gap-[0.06em] font-extrabold text-[17px] leading-none tracking-tight',
      className,
    )}
  >
    <span className="leading-none">Pane</span>
    <span
      aria-hidden
      className="mb-[0.14em] inline-block size-[0.32em] shrink-0 bg-current"
    />
  </span>
)
