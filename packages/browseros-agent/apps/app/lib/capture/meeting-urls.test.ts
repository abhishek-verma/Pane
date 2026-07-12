/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  isMeetingHost,
  isMeetingRoomUrl,
  isMeetingUrl,
  meetingHostname,
  meetingRoomLabel,
} from './meeting-urls'

describe('meeting url heuristics', () => {
  it('detects in-call Google Meet room URLs', () => {
    expect(isMeetingRoomUrl('https://meet.google.com/bdb-xbat-xzr')).toBe(true)
    expect(isMeetingRoomUrl('https://meet.google.com/abc-defg-hij')).toBe(true)
    expect(isMeetingRoomUrl('https://meet.google.com/landing')).toBe(false)
    expect(isMeetingRoomUrl('https://meet.google.com/new')).toBe(false)
    expect(isMeetingRoomUrl('https://meet.google.com/landing?hs=193')).toBe(
      false,
    )
  })

  it('detects Zoom and Teams room URLs', () => {
    expect(isMeetingRoomUrl('https://us02web.zoom.us/j/123456789')).toBe(true)
    expect(
      isMeetingRoomUrl('https://teams.microsoft.com/l/meetup-join/abc'),
    ).toBe(true)
    expect(isMeetingRoomUrl('https://example.com/docs')).toBe(false)
  })

  it('isMeetingUrl aliases room detection', () => {
    expect(isMeetingUrl('https://meet.google.com/bdb-xbat-xzr')).toBe(true)
    expect(isMeetingUrl('https://meet.google.com/landing')).toBe(false)
  })

  it('detects meeting hosts separately from rooms', () => {
    expect(isMeetingHost('https://meet.google.com/landing')).toBe(true)
    expect(isMeetingHost('https://example.com/')).toBe(false)
  })

  it('extracts hostnames and room labels', () => {
    expect(meetingHostname('https://meet.google.com/x')).toBe('meet.google.com')
    expect(meetingRoomLabel('https://meet.google.com/bdb-xbat-xzr')).toBe(
      'bdb-xbat-xzr',
    )
  })
})
