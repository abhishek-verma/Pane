/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ONBOARDING_STEP_COMPLETED_EVENT } from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import {
  ONBOARDING_ICP_OPTIONS,
  type OnboardingIcp,
} from '@/lib/onboarding/icp'
import { onboardingIcpStorage } from '@/lib/onboarding/onboardingStorage'
import { type StepDirection, StepTransition } from './StepTransition'

export interface StepIcpProps {
  direction: StepDirection
  onContinue: () => void
}

export const StepIcp = ({ direction, onContinue }: StepIcpProps) => {
  const [selected, setSelected] = useState<OnboardingIcp | null>(null)

  const handleContinue = async () => {
    if (!selected) return
    await onboardingIcpStorage.setValue(selected)
    track(ONBOARDING_STEP_COMPLETED_EVENT, {
      step: 'icp',
      icp: selected,
    })
    onContinue()
  }

  return (
    <StepTransition direction={direction}>
      <div className="mx-auto w-full max-w-lg space-y-6 px-6 py-10">
        <div className="space-y-2 text-center">
          <h2 className="font-bold text-2xl tracking-tight">
            How will you use Pane?
          </h2>
          <p className="text-muted-foreground text-sm">
            This seeds Pane&apos;s persona in SOUL.md. You can change it anytime
            in Settings → Memory & Skills.
          </p>
        </div>

        <div className="space-y-2">
          {ONBOARDING_ICP_OPTIONS.map((option) => {
            const active = selected === option.id
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelected(option.id)}
                className={`w-full rounded-lg border p-4 text-left transition-colors ${
                  active
                    ? 'border-[var(--accent-orange)] bg-[var(--accent-orange)]/5'
                    : 'border-border bg-card hover:border-[var(--accent-orange)]/40'
                }`}
              >
                <div className="font-medium text-sm">{option.label}</div>
                <div className="mt-1 text-muted-foreground text-xs">
                  {option.description}
                </div>
              </button>
            )
          })}
        </div>

        <Button
          className="w-full"
          disabled={!selected}
          onClick={() => void handleContinue()}
        >
          Continue
        </Button>
      </div>
    </StepTransition>
  )
}
