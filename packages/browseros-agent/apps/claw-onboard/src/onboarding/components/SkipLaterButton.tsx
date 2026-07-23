import { Button } from '@/components/ui/button'

interface SkipLaterButtonProps {
  onClick: () => void
  label?: string
}

/** Ghost CTA to leave a setup step for Settings later. */
export function SkipLaterButton({
  onClick,
  label = 'Set up later in Settings',
}: SkipLaterButtonProps) {
  return (
    <Button type="button" size="lg" variant="ghost" onClick={onClick}>
      {label}
    </Button>
  )
}
