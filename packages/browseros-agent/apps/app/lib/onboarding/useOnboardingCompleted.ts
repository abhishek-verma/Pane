/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useEffect, useState } from 'react'
import { loadProviders } from '@/lib/llm-providers/storage'
import { onboardingCompletedStorage } from './onboardingStorage'

export type OnboardingCompletedState =
  | { status: 'loading' }
  | { status: 'ready'; completed: boolean }

/**
 * Existing installs never wrote `onboardingCompleted`. If they already have a
 * provider configured, treat them as complete so the new route gate does not
 * force them back through setup.
 */
export async function resolveOnboardingCompleted(): Promise<boolean> {
  const completed = await onboardingCompletedStorage.getValue()
  if (completed) return true

  try {
    const providers = await loadProviders()
    if (providers.length > 0) {
      await onboardingCompletedStorage.setValue(true)
      return true
    }
  } catch {
    // Best-effort migration only.
  }

  return false
}

/** Subscribes to whether product onboarding has been marked complete. */
export function useOnboardingCompleted(): OnboardingCompletedState {
  const [state, setState] = useState<OnboardingCompletedState>({
    status: 'loading',
  })

  useEffect(() => {
    let cancelled = false

    void resolveOnboardingCompleted().then((completed) => {
      if (!cancelled) {
        setState({ status: 'ready', completed })
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
