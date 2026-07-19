/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { meetAdapter } from './meet'
import { teamsAdapter } from './teams'
import type { MeetingDomProbe } from './types'
import { zoomAdapter } from './zoom'

function probe(facts: MeetingDomProbe['facts']): MeetingDomProbe {
  return {
    hostname: 'meet.google.com',
    href: 'https://meet.google.com/abc-defg-hij',
    bodyText: '12:34 leave call',
    pageTitle: 'Meet',
    facts,
  }
}

describe('meet probeActiveSpeaker (B-T1, B-T2)', () => {
  it('prefers caption-row speaker over tile heuristics (P1)', () => {
    const obs = meetAdapter.probeActiveSpeaker?.(
      probe({
        matchedSelectors: ['[role="region"][aria-label="Captions"]'],
        ariaLabels: ['Bob is speaking'],
        speakingCandidates: [
          { name: 'Bob', signals: ['aria-speaking'] },
          { name: 'Ada', signals: ['caption-row'] },
        ],
        captionRows: [{ speaker: 'Ada', text: 'Hello everyone' }],
        selfName: 'You',
      }),
    )
    expect(obs?.displayName).toBe('Ada')
    expect(obs?.confidence).toBeGreaterThanOrEqual(0.95)
    expect(obs?.source).toBe('caption-row')
  })

  it('falls back to aria-speaking when captions are off', () => {
    const obs = meetAdapter.probeActiveSpeaker?.(
      probe({
        matchedSelectors: [],
        ariaLabels: ['Ada is speaking'],
        speakingCandidates: [{ name: 'Ada', signals: ['aria-speaking'] }],
        selfName: 'You',
      }),
    )
    expect(obs?.displayName).toBe('Ada')
    expect(obs?.confidence).toBeGreaterThanOrEqual(0.85)
    expect(obs?.source).toBe('dom-active')
  })

  it('maps self name when signals include self', () => {
    const obs = meetAdapter.probeActiveSpeaker?.(
      probe({
        matchedSelectors: [],
        ariaLabels: [],
        speakingCandidates: [
          { name: 'You', signals: ['aria-speaking', 'self'] },
        ],
        selfName: 'Abhishek',
      }),
    )
    expect(obs?.isLocalSelf).toBe(true)
    expect(obs?.displayName).toBe('Abhishek')
  })

  it('rejects weak signals below confidence threshold', () => {
    const obs = meetAdapter.probeActiveSpeaker?.(
      probe({
        matchedSelectors: [],
        ariaLabels: [],
        speakingCandidates: [{ name: 'Mystery', signals: ['maybe'] }],
      }),
    )
    expect(obs).toBeNull()
  })

  it('rejects generic Participant label', () => {
    const obs = meetAdapter.probeActiveSpeaker?.(
      probe({
        matchedSelectors: [],
        ariaLabels: [],
        speakingCandidates: [
          { name: 'Participant', signals: ['aria-speaking'] },
        ],
      }),
    )
    expect(obs).toBeNull()
  })

  it('accepts presenting at 0.8', () => {
    const obs = meetAdapter.probeActiveSpeaker?.(
      probe({
        matchedSelectors: [],
        ariaLabels: [],
        speakingCandidates: [{ name: 'Bob', signals: ['presenting'] }],
      }),
    )
    expect(obs?.displayName).toBe('Bob')
    expect(obs?.confidence).toBe(0.8)
  })

  it('rejects caption speakers that look like utterances', () => {
    const obs = meetAdapter.probeActiveSpeaker?.(
      probe({
        matchedSelectors: [],
        ariaLabels: [],
        speakingCandidates: [],
        captionRows: [
          {
            speaker: 'this is a long caption line mistaken for a name',
            text: 'hello',
          },
        ],
      }),
    )
    expect(obs).toBeNull()
  })

  it('cleans (You) suffix from caption speakers', () => {
    const obs = meetAdapter.probeActiveSpeaker?.(
      probe({
        matchedSelectors: [],
        ariaLabels: [],
        speakingCandidates: [],
        captionRows: [{ speaker: 'Ada (You)', text: 'Hi there' }],
        selfName: 'Ada',
      }),
    )
    expect(obs?.displayName).toBe('Ada')
    expect(obs?.isLocalSelf).toBe(true)
  })
})

describe('meet evaluateCallState leave', () => {
  it('treats return-to-home-screen as left', () => {
    expect(
      meetAdapter.evaluateCallState({
        hostname: 'meet.google.com',
        href: 'https://meet.google.com/abc-defg-hij',
        bodyText: 'Return to home screen\nRejoin',
        pageTitle: 'Meet',
        facts: {
          matchedSelectors: [],
          ariaLabels: [],
          speakingCandidates: [],
        },
      }),
    ).toBe('left')
  })
})

describe('zoom/teams speaker probes (C-T1)', () => {
  it('Zoom aria-speaking', () => {
    const obs = zoomAdapter.probeActiveSpeaker?.({
      hostname: 'us02web.zoom.us',
      href: 'https://us02web.zoom.us/wc/123',
      bodyText: '',
      pageTitle: 'Zoom',
      facts: {
        matchedSelectors: ['#meeting-client'],
        ariaLabels: ['Carol is speaking'],
        speakingCandidates: [{ name: 'Carol', signals: ['aria-speaking'] }],
      },
    })
    expect(obs?.displayName).toBe('Carol')
    expect(obs?.confidence).toBeGreaterThanOrEqual(0.6)
  })

  it('Zoom maps initials via attendee roster (P3)', () => {
    const obs = zoomAdapter.probeActiveSpeaker?.({
      hostname: 'us02web.zoom.us',
      href: 'https://us02web.zoom.us/wc/123',
      bodyText: '',
      pageTitle: 'Zoom',
      facts: {
        matchedSelectors: ['#meeting-client'],
        ariaLabels: [],
        speakingCandidates: [{ name: 'AL', signals: ['aria-speaking'] }],
        attendees: [
          { displayName: 'Ada Lovelace', initials: 'AL' },
          { displayName: 'Bob Martinez', initials: 'BM' },
        ],
      },
    })
    expect(obs?.displayName).toBe('Ada Lovelace')
  })

  it('Zoom prefers caption rows when present', () => {
    const obs = zoomAdapter.probeActiveSpeaker?.({
      hostname: 'us02web.zoom.us',
      href: 'https://us02web.zoom.us/wc/123',
      bodyText: '',
      pageTitle: 'Zoom',
      facts: {
        matchedSelectors: ['#meeting-client'],
        ariaLabels: [],
        speakingCandidates: [{ name: 'X', signals: ['border-active'] }],
        captionRows: [{ speaker: 'AL', text: 'Sharing the deck' }],
        attendees: [{ displayName: 'Ada Lovelace', initials: 'AL' }],
      },
    })
    expect(obs?.displayName).toBe('Ada Lovelace')
    expect(obs?.source).toBe('caption-row')
  })

  it('Teams border-active', () => {
    const obs = teamsAdapter.probeActiveSpeaker?.({
      hostname: 'teams.microsoft.com',
      href: 'https://teams.microsoft.com/l/meetup-join/x',
      bodyText: '',
      pageTitle: 'Teams',
      facts: {
        matchedSelectors: ['[data-tid="call-hangup"]'],
        ariaLabels: [],
        speakingCandidates: [{ name: 'Dana', signals: ['border-active'] }],
      },
    })
    expect(obs?.displayName).toBe('Dana')
  })
})
