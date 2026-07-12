/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * DOM heuristics for whether a meeting tab is in-call vs pre-join/lobby.
 *
 * Google Meet renders call controls in shadow DOM, so positive button
 * selectors are unreliable. Prefer blocking only definite pre-join / post-leave
 * page text on a room URL.
 */

export type MeetingCallState = 'prejoin' | 'in-call' | 'left'

export interface MeetingInCallProbe {
  hostname: string
  bodyText: string
  pageTitle?: string
  matchesSelector(selector: string): boolean
  ariaLabelIncludes(text: string): boolean
}

/** Visible copy on Google Meet pre-join / lobby screens. */
const GOOGLE_MEET_PRE_JOIN = [
  'join now',
  'ask to join',
  "you're waiting to be let in",
  'waiting for the host',
  'getting ready to join',
  'green room',
  'check your camera',
  'check your microphone',
  'choose how you want to join',
  'other ways to join',
  'return to home screen',
] as const

/** Visible copy after leaving a call while still on the room URL. */
const GOOGLE_MEET_LEFT = ['you left the meeting'] as const

export function evaluateMeetingCallState(
  probe: MeetingInCallProbe,
): MeetingCallState {
  const host = probe.hostname.toLowerCase()
  const text = probe.bodyText.toLowerCase()

  if (host === 'meet.google.com') {
    if (GOOGLE_MEET_LEFT.some((phrase) => text.includes(phrase))) {
      return 'left'
    }
    if ((probe.pageTitle ?? '').trim().toLowerCase() === 'google meet') {
      return 'prejoin'
    }
    if (GOOGLE_MEET_PRE_JOIN.some((phrase) => text.includes(phrase))) {
      return 'prejoin'
    }
    // In-call timer or leave-call copy visible in page text.
    if (
      /\b\d{1,2}:\d{2}\b/.test(text) ||
      text.includes('leave call') ||
      text.includes('end call')
    ) {
      return 'in-call'
    }
    return 'prejoin'
  }

  if (/^[a-z0-9-]+\.zoom\.us$/i.test(host)) {
    const inMeeting =
      probe.matchesSelector('#meeting-client') ||
      probe.matchesSelector('.meeting-app') ||
      probe.matchesSelector('#wc-container')
    const hasJoin =
      probe.matchesSelector('#join-btn') ||
      probe.matchesSelector('.join-meeting')
    return inMeeting && !hasJoin ? 'in-call' : 'prejoin'
  }

  if (/^teams\.(microsoft|live)\.com$/i.test(host)) {
    if (text.includes('join now') || text.includes('lobby')) return 'prejoin'
    if (
      probe.ariaLabelIncludes('leave') ||
      probe.ariaLabelIncludes('hang up') ||
      probe.matchesSelector('[data-tid="call-hangup"]')
    ) {
      return 'in-call'
    }
    return 'prejoin'
  }

  return 'in-call'
}

export function evaluateMeetingInCall(probe: MeetingInCallProbe): boolean {
  return evaluateMeetingCallState(probe) === 'in-call'
}

/**
 * Injected into the meeting tab via executeScript.
 * MUST be fully self-contained — no outer references (Chrome serializes this).
 */
export function probeMeetingCallStatePage(): MeetingCallState {
  const host = location.hostname.toLowerCase()
  const text = document.body?.innerText?.toLowerCase() ?? ''

  if (host === 'meet.google.com') {
    if (['you left the meeting'].some((phrase) => text.includes(phrase))) {
      return 'left'
    }
    if (document.title.trim().toLowerCase() === 'google meet') {
      return 'prejoin'
    }

    const preJoin = [
      'join now',
      'ask to join',
      "you're waiting to be let in",
      'waiting for the host',
      'getting ready to join',
      'green room',
      'check your camera',
      'check your microphone',
      'choose how you want to join',
      'other ways to join',
      'return to home screen',
    ]
    if (preJoin.some((phrase) => text.includes(phrase))) return 'prejoin'

    if (
      /\b\d{1,2}:\d{2}\b/.test(text) ||
      text.includes('leave call') ||
      text.includes('end call')
    ) {
      return 'in-call'
    }
    return 'prejoin'
  }

  const ariaLabelIncludes = (needle: string) => {
    const lower = needle.toLowerCase()
    return Array.from(document.querySelectorAll('[aria-label]')).some((el) =>
      (el.getAttribute('aria-label') ?? '').toLowerCase().includes(lower),
    )
  }

  if (/^[a-z0-9-]+\.zoom\.us$/i.test(host)) {
    const inMeeting = Boolean(
      document.querySelector('#meeting-client, .meeting-app, #wc-container'),
    )
    const hasJoin = Boolean(document.querySelector('#join-btn, .join-meeting'))
    return inMeeting && !hasJoin ? 'in-call' : 'prejoin'
  }

  if (/^teams\.(microsoft|live)\.com$/i.test(host)) {
    if (text.includes('join now') || text.includes('lobby')) return 'prejoin'
    if (
      ariaLabelIncludes('leave') ||
      ariaLabelIncludes('hang up') ||
      document.querySelector('[data-tid="call-hangup"]')
    ) {
      return 'in-call'
    }
    return 'prejoin'
  }

  return 'in-call'
}

/** @deprecated Prefer probeMeetingCallStatePage */
export function probeMeetingInCallPage(): boolean {
  return probeMeetingCallStatePage() === 'in-call'
}
