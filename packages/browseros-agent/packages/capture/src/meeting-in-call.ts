/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Thin wrappers over meeting site adapters for call-state evaluation.
 * Prefer `@browseros/capture/adapters` for new code.
 *
 * Adapters return `unknown` when unsure — callers must fail soft (keep recording,
 * never auto-stop on unknown).
 */

import { MEETING_SELECTOR_ALLOWLIST } from './adapters/dom-facts'
import { genericAdapter } from './adapters/generic'
import { getAdapterForHost } from './adapters/registry'
import type { MeetingDomProbe } from './adapters/types'
import type { MeetingCallState } from './types'

export type { MeetingCallState, MeetingDomProbe }

/** @deprecated Prefer MeetingDomProbe + adapter.evaluateCallState */
export interface MeetingInCallProbe {
  hostname: string
  bodyText: string
  pageTitle?: string
  matchesSelector(selector: string): boolean
  ariaLabelIncludes(text: string): boolean
}

const COMMON_ARIA_NEEDLES = [
  'leave',
  'hang up',
  'leave huddle',
  'unmute',
  'mute',
  'turn on microphone',
  'turn off microphone',
  'speaking',
  'presenting',
] as const

function legacyProbeToDom(probe: MeetingInCallProbe): MeetingDomProbe {
  const matchedSelectors = MEETING_SELECTOR_ALLOWLIST.filter((sel) => {
    try {
      return probe.matchesSelector(sel)
    } catch {
      return false
    }
  })
  const ariaLabels = COMMON_ARIA_NEEDLES.filter((needle) =>
    probe.ariaLabelIncludes(needle),
  )
  return {
    hostname: probe.hostname,
    href: '',
    bodyText: probe.bodyText,
    pageTitle: probe.pageTitle ?? '',
    facts: {
      matchedSelectors: [...matchedSelectors],
      ariaLabels: [...ariaLabels],
      speakingCandidates: [],
    },
  }
}

export function evaluateMeetingCallStateFromProbe(
  probe: MeetingDomProbe,
): MeetingCallState {
  const adapter = getAdapterForHost(probe.hostname) ?? genericAdapter
  return adapter.evaluateCallState(probe)
}

/**
 * Legacy probe shape — converts to MeetingDomProbe then dispatches to adapters.
 */
export function evaluateMeetingCallState(
  probe: MeetingInCallProbe,
): MeetingCallState {
  return evaluateMeetingCallStateFromProbe(legacyProbeToDom(probe))
}

export function evaluateMeetingInCall(probe: MeetingInCallProbe): boolean {
  return evaluateMeetingCallState(probe) === 'in-call'
}

/**
 * Optional mute probe — metadata only; never drives lifecycle.
 */
export function evaluateLocalMute(
  probe: MeetingInCallProbe,
): boolean | 'unknown' {
  const dom = legacyProbeToDom(probe)
  const adapter = getAdapterForHost(dom.hostname)
  const muted = adapter?.probeLocalMute?.(dom)
  if (muted === true) return true
  if (muted === false) return false
  return 'unknown'
}

/**
 * @deprecated Injected collectors should use collectMeetingDomFactsPage.
 * Kept for any remaining executeScript callers; self-contained call-state.
 */
export function probeMeetingCallStatePage(): MeetingCallState {
  const host = location.hostname.toLowerCase()
  const text = document.body?.innerText?.toLowerCase() ?? ''

  const ariaLabelIncludes = (needle: string) => {
    const lower = needle.toLowerCase()
    return Array.from(document.querySelectorAll('[aria-label]')).some((el) =>
      (el.getAttribute('aria-label') ?? '').toLowerCase().includes(lower),
    )
  }

  if (host === 'meet.google.com') {
    const left = [
      'you left the meeting',
      "you've left the meeting",
      'you left the call',
      'return to home screen',
      'thanks for joining',
      'meeting has ended',
      'the meeting has ended',
      'call ended',
    ]
    if (left.some((phrase) => text.includes(phrase))) return 'left'
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

  if (host === 'app.slack.com') {
    if (text.includes('huddle has ended') || text.includes('left the huddle')) {
      return 'left'
    }
    if (text.includes('start a huddle') || text.includes('join huddle')) {
      return 'prejoin'
    }
    if (
      text.includes('leave huddle') ||
      ariaLabelIncludes('leave huddle') ||
      document.querySelector('[data-qa="huddle_leave_button"]')
    ) {
      return 'in-call'
    }
    return 'unknown'
  }

  if (/^[a-z0-9-]+\.webex\.com$/i.test(host)) {
    if (
      text.includes('you have left the meeting') ||
      text.includes('meeting ended')
    ) {
      return 'left'
    }
    if (text.includes('join meeting') || text.includes('enter room')) {
      return 'prejoin'
    }
    if (ariaLabelIncludes('leave') || text.includes('leave meeting')) {
      return 'in-call'
    }
    return 'unknown'
  }

  return 'unknown'
}

/** @deprecated Prefer probeMeetingCallStatePage */
export function probeMeetingInCallPage(): boolean {
  return probeMeetingCallStatePage() === 'in-call'
}
