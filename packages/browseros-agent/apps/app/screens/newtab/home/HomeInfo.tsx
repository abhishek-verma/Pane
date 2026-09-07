import { Info } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/** Supporting context stays off the page, but works with mouse, keyboard and touch. */
export function HomeInfo({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const pinned = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const keepOpen = () => {
    clearTimeout(timer.current)
    setOpen(true)
  }
  const closeSoon = () => {
    if (pinned.current) return
    timer.current = setTimeout(() => setOpen(false), 180)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (!value) pinned.current = false
        setOpen(value)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="home-icon-button"
          aria-label={label}
          onClick={(event) => {
            event.preventDefault()
            clearTimeout(timer.current)
            pinned.current = !pinned.current
            setOpen(pinned.current)
          }}
          onMouseEnter={keepOpen}
          onMouseLeave={closeSoon}
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        className="home-floating max-h-[min(420px,70dvh,var(--radix-popover-content-available-height))] w-72 max-w-[calc(100vw-32px)] space-y-3 overflow-y-auto text-xs leading-relaxed [overflow-wrap:anywhere]"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onMouseEnter={keepOpen}
        onMouseLeave={closeSoon}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
