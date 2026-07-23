/**
 * Build-time Pane version for the onboarding rail footer.
 * Overridden in chromium builds via Vite `define`.
 */
declare const __PANE_ONBOARDING_VERSION__: string | undefined

export const PANE_ONBOARDING_VERSION =
  typeof __PANE_ONBOARDING_VERSION__ !== 'undefined' &&
  __PANE_ONBOARDING_VERSION__
    ? __PANE_ONBOARDING_VERSION__
    : '0.47.0'

/** Human platform label for the onboarding rail footer. */
export function onboardingPlatformLabel(
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): string {
  if (/Mac/i.test(userAgent)) return 'macOS'
  if (/Windows/i.test(userAgent)) return 'Windows'
  if (/Linux/i.test(userAgent)) return 'Linux'
  return 'Desktop'
}
