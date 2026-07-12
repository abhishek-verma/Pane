/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  isMeetingHost,
  isMeetingRoomUrl,
  meetingRoomLabel,
} from './meeting-urls'

describe('@browseros/capture meeting-urls', () => {
  it('excludes Google Meet landing pages', () => {
    expect(isMeetingRoomUrl('https://meet.google.com/landing')).toBe(false)
    expect(isMeetingRoomUrl('https://meet.google.com/new')).toBe(false)
    expect(isMeetingRoomUrl('https://meet.google.com/bdb-xbat-xzr')).toBe(true)
  })

  it('still recognizes meet host for consent', () => {
    expect(isMeetingHost('https://meet.google.com/landing')).toBe(true)
  })

  it('extracts room labels', () => {
    expect(meetingRoomLabel('https://meet.google.com/bdb-xbat-xzr')).toBe(
      'bdb-xbat-xzr',
    )
  })
})
