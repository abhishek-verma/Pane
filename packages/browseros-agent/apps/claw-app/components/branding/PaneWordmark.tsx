import type { FC } from 'react'
import { cn } from '@/lib/utils'

const sizeClasses = {
  sm: 'text-base',
  md: 'text-2xl',
} as const

const periodSizes = {
  sm: 'size-[0.32em] mb-[0.14em]',
  md: 'size-[0.32em] mb-[0.14em]',
} as const

export interface PaneWordmarkProps {
  size?: keyof typeof sizeClasses
  className?: string
  withMark?: boolean
}

/** Wordmark: Pane + small square as the full stop. */
export const PaneWordmark: FC<PaneWordmarkProps> = ({
  size = 'md',
  className,
  withMark = true,
}) => (
  <span
    className={cn(
      'inline-flex flex-nowrap items-end gap-[0.06em] font-semibold leading-none tracking-tight',
      sizeClasses[size],
      className,
    )}
  >
    <span className="leading-none">Pane</span>
    {withMark ? (
      <span
        aria-hidden
        className={cn('inline-block shrink-0 bg-current', periodSizes[size])}
      />
    ) : null}
  </span>
)
