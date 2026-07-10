/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  ONBOARDING_ICP_OPTIONS,
  personaIdForIcp,
} from '../../lib/onboarding/icp'

describe('personaIdForIcp', () => {
  it('maps each ICP option to a persona', () => {
    expect(personaIdForIcp('research')).toBe('research-buddy')
    expect(personaIdForIcp('job-search')).toBe('job-search-partner')
    expect(personaIdForIcp('personal-automation')).toBe('chief-of-staff')
    expect(personaIdForIcp('coding')).toBe('default')
    expect(personaIdForIcp('privacy')).toBe('default')
    expect(personaIdForIcp(null)).toBe('default')
  })

  it('covers all declared ICP options', () => {
    for (const option of ONBOARDING_ICP_OPTIONS) {
      expect(personaIdForIcp(option.id)).toBe(option.personaId)
    }
  })
})
