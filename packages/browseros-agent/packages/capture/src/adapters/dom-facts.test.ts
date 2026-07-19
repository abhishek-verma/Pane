/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { MEETING_SELECTOR_ALLOWLIST } from './dom-facts'

describe('collectMeetingDomFactsPage allowlist (A-T3 / P2)', () => {
  it('includes mature call-state selectors', () => {
    expect(MEETING_SELECTOR_ALLOWLIST).toContain('#meeting-client')
    expect(MEETING_SELECTOR_ALLOWLIST).toContain('[data-tid="call-hangup"]')
    expect(MEETING_SELECTOR_ALLOWLIST).toContain(
      '[data-qa="huddle_leave_button"]',
    )
    expect(MEETING_SELECTOR_ALLOWLIST.some((s) => s.includes('speaking'))).toBe(
      true,
    )
  })

  it('includes Captions region selectors for CC scrape', () => {
    expect(MEETING_SELECTOR_ALLOWLIST).toContain(
      '[role="region"][aria-label="Captions"]',
    )
    expect(MEETING_SELECTOR_ALLOWLIST).toContain('[aria-live="polite"]')
  })
})
