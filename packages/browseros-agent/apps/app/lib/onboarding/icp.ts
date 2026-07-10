/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type OnboardingIcp =
  | 'coding'
  | 'research'
  | 'personal-automation'
  | 'privacy'
  | 'job-search'

export const ONBOARDING_ICP_OPTIONS: Array<{
  id: OnboardingIcp
  label: string
  description: string
  personaId:
    | 'default'
    | 'chief-of-staff'
    | 'job-search-partner'
    | 'research-buddy'
}> = [
  {
    id: 'coding',
    label: 'Coding & building',
    description: 'Ship features, debug, and automate your repo workflow.',
    personaId: 'default',
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Synthesize tabs, papers, and sources with citations.',
    personaId: 'research-buddy',
  },
  {
    id: 'personal-automation',
    label: 'Personal automation',
    description: 'Run errands across the web — inbox, calendar, admin.',
    personaId: 'chief-of-staff',
  },
  {
    id: 'privacy',
    label: 'Private local agent',
    description: 'Keep everything on-device; minimize cloud surface.',
    personaId: 'default',
  },
  {
    id: 'job-search',
    label: 'Job search',
    description: 'Track applications, tailor outreach, prep interviews.',
    personaId: 'job-search-partner',
  },
]

export function personaIdForIcp(
  icp: OnboardingIcp | null | undefined,
): (typeof ONBOARDING_ICP_OPTIONS)[number]['personaId'] {
  return (
    ONBOARDING_ICP_OPTIONS.find((o) => o.id === icp)?.personaId ?? 'default'
  )
}
