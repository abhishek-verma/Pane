import { Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DisplayHeading, Em, StepCopy } from '../components/DisplayHeading'
import { StepWrap } from '../components/StepWrap'

interface WelcomeStepProps {
  onPrimary: () => void
  onSkip: () => void
}

/** Renders the opening onboarding step and setup/reconnect choices. */
export function WelcomeStep({ onPrimary, onSkip }: WelcomeStepProps) {
  return (
    <StepWrap>
      <DisplayHeading>
        The browser your agents <Em>drive</Em>.
      </DisplayHeading>
      <StepCopy>
        Logged in as you, fast, and under your control. Import logins, add a
        model, connect Claude if you want, then open Pane. Every step can be
        skipped and finished later in Settings.
      </StepCopy>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" onClick={onPrimary}>
          <Zap className="size-4" />
          Set up Pane
        </Button>
        <Button type="button" size="lg" variant="ghost" onClick={onSkip}>
          Skip setup . open Pane
        </Button>
      </div>
    </StepWrap>
  )
}
