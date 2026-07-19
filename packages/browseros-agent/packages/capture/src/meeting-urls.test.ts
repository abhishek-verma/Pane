/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  detectMeetingRoom,
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

  it('detects Slack huddle room keys', () => {
    expect(
      detectMeetingRoom('https://app.slack.com/huddle/T026CMCFV4H/D026SCN0LAU'),
    ).toEqual({
      site: 'slack',
      roomKey: 'slack:t026cmcfv4h/d026scn0lau',
    })
    expect(isMeetingRoomUrl('https://app.slack.com/client/T1/C1')).toBe(false)
  })

  it('detects Webex personal room keys', () => {
    expect(detectMeetingRoom('https://acme.webex.com/meet/jane.doe')).toEqual({
      site: 'webex',
      roomKey: 'webex:acme.webex.com/jane.doe',
    })
  })

  it('detects Zoom meeting ids', () => {
    expect(detectMeetingRoom('https://us02web.zoom.us/j/123456789')).toEqual({
      site: 'zoom',
      roomKey: 'zoom:123456789',
    })
  })
})
