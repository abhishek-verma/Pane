import { AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface ChromeQuitNoticeProps {
  onQuitChrome: () => void
}

/** Prompts the user to close Chrome before profile import can continue. */
export function ChromeQuitNotice({ onQuitChrome }: ChromeQuitNoticeProps) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber/30 bg-amber-tint p-4">
      <AlertTriangle className="mt-0.5 size-[18px] shrink-0 text-amber" />
      <div className="flex-1">
        <div className="mb-1 font-bold text-[13.5px]">Chrome is open</div>
        <div className="mb-3 text-[12.5px] text-ink-2 leading-[1.5]">
          It needs to close so we can read your data safely. We&rsquo;ll never
          force-quit or touch your profile.
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onQuitChrome}>
          <X className="size-3.5" />
          Quit Chrome for me
        </Button>
      </div>
    </div>
  )
}
