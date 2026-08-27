import { type FC, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * Renders a single-line, non-wrapping caption that stays scrolled to its
 * tail as `text` grows — so the most recently streamed words remain
 * visible instead of being clipped by `overflow: hidden`.
 */
export const LiveCaption: FC<{ text: string; className?: string }> = ({
  text,
  className,
}) => {
  const ref = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: rerun on each new chunk to keep the tail scrolled into view
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [text])

  return (
    <div
      ref={ref}
      className={cn(
        'overflow-hidden whitespace-nowrap text-muted-foreground text-xs italic',
        className,
      )}
    >
      {text}
    </div>
  )
}
