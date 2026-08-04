/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { evaluateMeetingCallStateFromProbe } from '../meeting-in-call'
import {
  detectMeetingRoom,
  detectMeetingRoomForCapture,
  isMeetingHost,
  isMeetingRoomUrl,
  meetingRoomLabel,
} from '../meeting-urls'
import { meetAdapter } from './meet'
import {
  getAdapterForHost,
  isMeetingConsentAllowed,
  listMatureAdapterMeta,
  resolveCaptureAdapter,
} from './registry'
import type { MeetingDomProbe } from './types'

function factsProbe(
  partial: Partial<MeetingDomProbe> & { hostname: string },
): MeetingDomProbe {
  return {
    hostname: partial.hostname,
    href: partial.href ?? `https://${partial.hostname}/`,
    bodyText: partial.bodyText ?? '',
    pageTitle: partial.pageTitle ?? '',
    facts: partial.facts ?? {
      matchedSelectors: [],
      ariaLabels: [],
      speakingCandidates: [],
    },
  }
}

describe('adapters registry (A-T1, A-T4, A-T5)', () => {
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

  it('resolveCaptureAdapter: mature / generic / null', () => {
    expect(
      resolveCaptureAdapter('https://meet.google.com/abc-defg-hij', [
        'meet.google.com',
      ])?.id,
    ).toBe('meet')
    expect(
      resolveCaptureAdapter('https://example.com/call', ['meet.google.com']),
    ).toBeNull()
    expect(
      resolveCaptureAdapter('https://example.com/call', ['example.com'])?.id,
    ).toBe('generic')
  })

  it('consent helper: zoom.us allowed matches company.zoom.us', () => {
    expect(isMeetingConsentAllowed('us02web.zoom.us', ['zoom.us'])).toBe(true)
    expect(isMeetingConsentAllowed('acme.webex.com', ['webex.com'])).toBe(true)
    expect(isMeetingConsentAllowed('evil.com', ['zoom.us'])).toBe(false)
  })

  it('lists five mature adapters for Settings', () => {
    const meta = listMatureAdapterMeta()
    expect(meta.map((m) => m.id).sort()).toEqual([
      'meet',
      'slack',
      'teams',
      'webex',
      'zoom',
    ])
  })

  it('detectMeetingRoomForCapture resolves generic rooms', () => {
    expect(
      detectMeetingRoomForCapture('https://example.com/room/1', [
        'example.com',
      ]),
    ).toEqual({
      site: 'generic',
      roomKey: 'generic:example.com/room/1',
    })
  })

  it('getAdapterForHost returns meet', () => {
    expect(getAdapterForHost('meet.google.com')).toBe(meetAdapter)
  })
})

describe('adapters call-state from facts (A-T2)', () => {
  it('returns prejoin on Google Meet join screen', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'meet.google.com',
          bodyText: 'Join now\nGetting ready to join',
        }),
      ),
    ).toBe('prejoin')
  })

  it('returns prejoin on room URL without in-call signals', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'meet.google.com',
          bodyText: 'Meet - standup\nSome participants',
        }),
      ),
    ).toBe('prejoin')
  })

  it('returns in-call when call timer is visible', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'meet.google.com',
          bodyText: 'Alice\nBob\n12:34',
        }),
      ),
    ).toBe('in-call')
  })

  it('returns in-call when visible leave control is present', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'meet.google.com',
          bodyText: 'Alice\nBob',
          facts: {
            matchedSelectors: [],
            ariaLabels: [],
            speakingCandidates: [],
            hasVisibleLeaveControl: true,
          },
        }),
      ),
    ).toBe('in-call')
  })

  it('returns prejoin when visible join control is present', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'meet.google.com',
          bodyText: '12:34 leave call',
          facts: {
            matchedSelectors: [],
            ariaLabels: [],
            speakingCandidates: [],
            hasVisibleJoinControl: true,
            hasVisibleLeaveControl: false,
          },
        }),
      ),
    ).toBe('prejoin')
  })

  it('returns left after leaving the meeting', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'meet.google.com',
          bodyText: 'You left the meeting\nRejoin\nReturn to home screen',
        }),
      ),
    ).toBe('left')
  })

  it('returns left when only return-to-home-screen is visible', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'meet.google.com',
          bodyText: 'Return to home screen',
        }),
      ),
    ).toBe('left')
  })

  it('returns unknown for unclear Slack huddle DOM', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'app.slack.com',
          bodyText: 'channel messages unrelated',
        }),
      ),
    ).toBe('unknown')
  })

  it('returns in-call for Slack leave huddle control', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'app.slack.com',
          bodyText: 'Leave huddle',
          facts: {
            matchedSelectors: ['[data-qa="huddle_leave_button"]'],
            ariaLabels: ['Leave huddle'],
            speakingCandidates: [],
          },
        }),
      ),
    ).toBe('in-call')
  })

  it('Zoom in-meeting selectors', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'us02web.zoom.us',
          facts: {
            matchedSelectors: ['#meeting-client'],
            ariaLabels: [],
            speakingCandidates: [],
          },
        }),
      ),
    ).toBe('in-call')
  })
})

describe('Zoom PWA call-state resilience', () => {
  // Participant — sees "Leave" button
  it('participant in-call via Leave button', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'app.zoom.us',
          href: 'https://app.zoom.us/wc/82259304410/start',
          facts: {
            matchedSelectors: [],
            ariaLabels: ['Mute', 'Stop Video', 'Leave meeting'],
            speakingCandidates: [],
            hasVisibleLeaveControl: true,
            hasVisibleJoinControl: false,
            hasVisibleMuteControl: true,
          },
        }),
      ),
    ).toBe('in-call')
  })

  // Host — sees "End" button, not "Leave"
  it('host in-call via End button', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'app.zoom.us',
          href: 'https://app.zoom.us/wc/86539747306/start',
          facts: {
            matchedSelectors: [],
            ariaLabels: ['Mute', 'Stop Video', 'Participants', 'End'],
            speakingCandidates: [],
            hasVisibleLeaveControl: true,
            hasVisibleJoinControl: false,
            hasVisibleMuteControl: true,
          },
        }),
      ),
    ).toBe('in-call')
  })

  // Icon-only UI — no aria-label on leave/end, but mute button is always labeled
  it('in-call via mute button alone (icon-only leave button)', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'app.zoom.us',
          href: 'https://app.zoom.us/wc/86539747306/start',
          facts: {
            matchedSelectors: [],
            ariaLabels: ['Unmute', 'Start Video', 'Chat'],
            speakingCandidates: [],
            hasVisibleLeaveControl: false,
            hasVisibleJoinControl: false,
            hasVisibleMuteControl: true,
          },
        }),
      ),
    ).toBe('in-call')
  })

  // Pre-join — join button present overrides mute
  it('prejoin when join button present even if mute visible', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'app.zoom.us',
          facts: {
            matchedSelectors: [],
            ariaLabels: ['Mute', 'Join Now'],
            speakingCandidates: [],
            hasVisibleLeaveControl: false,
            hasVisibleJoinControl: true,
            hasVisibleMuteControl: true,
          },
        }),
      ),
    ).toBe('prejoin')
  })

  // Waiting room
  it('prejoin on waiting room body text', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'app.zoom.us',
          bodyText: 'Please wait, the meeting host will let you in soon.',
          facts: {
            matchedSelectors: [],
            ariaLabels: [],
            speakingCandidates: [],
          },
        }),
      ),
    ).toBe('prejoin')
  })

  // Passcode screen
  it('prejoin on passcode screen body text', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'app.zoom.us',
          bodyText: 'Enter meeting passcode',
          facts: {
            matchedSelectors: [],
            ariaLabels: [],
            speakingCandidates: [],
          },
        }),
      ),
    ).toBe('prejoin')
  })

  // Classic web client still works
  it('classic client in-call via #meeting-client', () => {
    expect(
      evaluateMeetingCallStateFromProbe(
        factsProbe({
          hostname: 'us05web.zoom.us',
          facts: {
            matchedSelectors: ['#meeting-client'],
            ariaLabels: [],
            speakingCandidates: [],
          },
        }),
      ),
    ).toBe('in-call')
  })
})
