import { storage } from '@wxt-dev/storage'
import type { OnboardingIcp } from './icp'

export interface OnboardingProfile {
  name: string
  /** One-line about the user — required in onboarding. */
  description: string
  role?: string
  company?: string
}

export const onboardingCompletedStorage = storage.defineItem<boolean>(
  'local:onboardingCompleted',
  { fallback: false },
)

export const onboardingProfileStorage =
  storage.defineItem<OnboardingProfile | null>('local:onboardingProfile', {
    fallback: null,
  })

/** ICP / soul preset from onboarding — seeds SOUL.md persona on first complete. */
export const onboardingIcpStorage = storage.defineItem<OnboardingIcp | null>(
  'local:onboardingIcp',
  { fallback: null },
)

export const signInHintDismissedAtStorage = storage.defineItem<number | null>(
  'local:signInHintDismissedAt',
  { fallback: null },
)

export const authRedirectPathStorage = storage.defineItem<string | null>(
  'local:authRedirectPath',
  { fallback: null },
)

export const firstRunConfettiShownStorage = storage.defineItem<boolean>(
  'local:firstRunConfettiShown',
  { fallback: false },
)
