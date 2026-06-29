import type { FC } from 'react'
import { PRODUCT_NAME } from '@/lib/constants/product'
import { cn } from '@/lib/utils'

const sizeClasses = {
  xs: 'text-[11.5px]',
  sm: 'text-base',
  md: 'text-2xl',
  lg: 'text-4xl',
  xl: 'text-5xl',
} as const

const periodSizes = {
  xs: 'size-[0.32em] mb-[0.14em]',
  sm: 'size-[0.32em] mb-[0.14em]',
  md: 'size-[0.32em] mb-[0.14em]',
  lg: 'size-[0.3em] mb-[0.15em]',
  xl: 'size-[0.28em] mb-[0.16em]',
} as const

export interface PaneWordmarkProps {
  size?: keyof typeof sizeClasses
  className?: string
  /** Show the square full stop after the word (default true — renders "Pane.") */
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
    <span className="leading-none">{PRODUCT_NAME}</span>
    {withMark ? (
      <span
        aria-hidden
        className={cn('inline-block shrink-0 bg-current', periodSizes[size])}
      />
    ) : null}
  </span>
)
