import { useEffect } from 'react'
import {
  ONBOARDING_CONNECT_APPS_SKIPPED_EVENT,
  ONBOARDING_STEP_COMPLETED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import { type StepDirection, StepTransition } from './StepTransition'

export interface StepConnectAppsProps {
  direction: StepDirection
  onContinue: () => void
}

export const StepConnectApps = ({
  direction,
  onContinue,
}: StepConnectAppsProps) => {
  useEffect(() => {
    track(ONBOARDING_CONNECT_APPS_SKIPPED_EVENT)
    track(ONBOARDING_STEP_COMPLETED_EVENT, {
      step: 2,
      step_name: 'connect_apps',
      skipped: true,
    })
    onContinue()
  }, [onContinue])

  return (
    <StepTransition direction={direction}>
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    </StepTransition>
  )
}
