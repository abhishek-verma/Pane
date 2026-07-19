/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { detectMeetingRoom } from '@browseros/capture/meeting-urls'
import {
  isMeetingHost,
  isMeetingRoomUrl,
  isMeetingUrl,
  meetingHostname,
  meetingRoomLabel,
} from './meeting-urls'

describe('meeting-urls (app re-export)', () => {
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
  })

  it('isMeetingUrl aliases isMeetingRoomUrl', () => {
    expect(isMeetingUrl('https://meet.google.com/bdb-xbat-xzr')).toBe(true)
    expect(isMeetingUrl('https://meet.google.com/landing')).toBe(false)
  })

  it('detects meeting hosts for consent', () => {
    expect(isMeetingHost('https://meet.google.com/landing')).toBe(true)
    expect(isMeetingHost('https://app.slack.com/huddle/T1/C1')).toBe(true)
  })

  it('extracts labels and room keys', () => {
    expect(meetingHostname('https://meet.google.com/x')).toBe('meet.google.com')
    expect(meetingRoomLabel('https://meet.google.com/bdb-xbat-xzr')).toBe(
      'bdb-xbat-xzr',
    )
    expect(
      detectMeetingRoom('https://app.slack.com/huddle/T1/C2')?.roomKey,
    ).toBe('slack:t1/c2')
  })
})
