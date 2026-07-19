import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface StepReplayBarProps {
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  className?: string
}

/** Prev/Next chrome for walking specialized evidence cards in a batch. */
export const StepReplayBar: FC<StepReplayBarProps> = ({
  index,
  total,
  onPrev,
  onNext,
  onClose,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-1.5 py-1',
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={index <= 0}
        onClick={onPrev}
        aria-label="Previous step"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <span className="min-w-[4.5rem] text-center text-[11px] text-muted-foreground tabular-nums">
        Step {index + 1} / {total}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={index >= total - 1}
        onClick={onNext}
        aria-label="Next step"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="ml-auto h-6 w-6"
        onClick={onClose}
        aria-label="Exit step replay"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
