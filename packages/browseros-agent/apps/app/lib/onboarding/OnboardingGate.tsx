/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC, ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useOnboardingCompleted } from './useOnboardingCompleted'

function isAllowedWhileIncomplete(pathname: string): boolean {
  if (pathname === '/onboarding' || pathname.startsWith('/onboarding/')) {
    return true
  }
  // Diagnostics can reset onboarding; keep it reachable for recovery.
  if (pathname.startsWith('/settings/diagnostics')) {
    return true
  }
  return false
}

/**
 * While product onboarding is incomplete, bounce every surface except
 * onboarding (and diagnostics) to `/onboarding`.
 */
export const OnboardingGate: FC<{ children: ReactNode }> = ({ children }) => {
  const location = useLocation()
  const state = useOnboardingCompleted()

  // Avoid blanking the app while storage loads; redirect once we know.
  if (
    state.status === 'ready' &&
    !state.completed &&
    !isAllowedWhileIncomplete(location.pathname)
  ) {
    return <Navigate to="/onboarding" replace />
  }

  return children
}
