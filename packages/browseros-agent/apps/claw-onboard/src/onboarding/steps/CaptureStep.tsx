import { ArrowRight, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DisplayHeading, Em, StepCopy } from '../components/DisplayHeading'
import { SkipLaterButton } from '../components/SkipLaterButton'
import { StepWrap } from '../components/StepWrap'

interface CaptureStepProps {
  onContinue: () => void
  onSkip: () => void
}

/** Offers meeting/browsing capture opt-in, deferred to Settings by default. */
export function CaptureStep({ onContinue, onSkip }: CaptureStepProps) {
  return (
    <StepWrap>
      <DisplayHeading>
        Optional <Em>capture</Em>.
      </DisplayHeading>
      <StepCopy>
        Pane can remember what you research and capture Meet / Zoom / Teams tabs
        locally — no bot in the call. Capture stays off until you enable it in
        Meetings or Settings. You can pause or delete anything anytime.
      </StepCopy>
      <div className="mb-4 rounded-xl border border-border-2 bg-card p-4 text-[12.5px] text-ink-2 leading-[1.5]">
        <div className="mb-1 font-bold text-[13px] text-ink">
          Off by default
        </div>
        Enabling later is one click in the sidebar under Meetings. Per-domain
        consent and a visible recording indicator keep you in control.
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" onClick={onContinue}>
          <Mic className="size-4" />
          Continue
          <ArrowRight className="size-4" />
        </Button>
        <SkipLaterButton onClick={onSkip} />
      </div>
    </StepWrap>
  )
}
