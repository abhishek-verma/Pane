/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useEffect, useState } from 'react'
import { onboardingCompletedStorage } from './onboardingStorage'

export type OnboardingCompletedState =
  | { status: 'loading' }
  | { status: 'ready'; completed: boolean }

/** Subscribes to whether product onboarding has been marked complete. */
export function useOnboardingCompleted(): OnboardingCompletedState {
  const [state, setState] = useState<OnboardingCompletedState>({
    status: 'loading',
  })

  useEffect(() => {
    let cancelled = false

    void onboardingCompletedStorage.getValue().then((completed) => {
      if (!cancelled) {
        setState({ status: 'ready', completed: Boolean(completed) })
      }
    })

    const unsubscribe = onboardingCompletedStorage.watch((completed) => {
      setState({ status: 'ready', completed: Boolean(completed) })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return state
}
