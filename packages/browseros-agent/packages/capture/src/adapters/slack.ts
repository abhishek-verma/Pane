/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { MeetingCallState } from '../types'
import type { MeetingDomProbe, MeetingSiteAdapter } from './types'

function hasSelector(probe: MeetingDomProbe, selector: string): boolean {
  return probe.facts.matchedSelectors.includes(selector)
}

function ariaIncludes(probe: MeetingDomProbe, needle: string): boolean {
  const lower = needle.toLowerCase()
  return probe.facts.ariaLabels.some((l) => l.toLowerCase().includes(lower))
}

function evaluateCallState(probe: MeetingDomProbe): MeetingCallState {
  const text = probe.bodyText.toLowerCase()
  if (text.includes('huddle has ended') || text.includes('left the huddle')) {
    return 'left'
  }
  if (
    text.includes('start a huddle') ||
    text.includes('join huddle') ||
    hasSelector(probe, '[data-qa="huddle_start_button"]')
  ) {
    return 'prejoin'
  }
  if (
    text.includes('leave huddle') ||
    ariaIncludes(probe, 'leave huddle') ||
    hasSelector(probe, '[data-qa="huddle_leave_button"]')
  ) {
    return 'in-call'
  }
  return 'unknown'
}

export const slackAdapter: MeetingSiteAdapter = {
  id: 'slack',
  displayName: 'Slack Huddles',
  maturity: 'mature',
  defaultHosts: ['app.slack.com'],
  capabilities: ['roomDetection', 'callState'],

  matchesHost(hostname: string): boolean {
    return hostname.toLowerCase() === 'app.slack.com'
  },

  detectRoom(url: string): { roomKey: string } | null {
    try {
      const parsed = new URL(url)
      if (!this.matchesHost(parsed.hostname)) return null
      const huddle = parsed.pathname.match(/^\/huddle\/([^/]+)\/([^/]+)/i)
      if (!huddle?.[1] || !huddle[2]) return null
      return {
        roomKey: `slack:${huddle[1].toLowerCase()}/${huddle[2].toLowerCase()}`,
      }
    } catch {
      return null
    }
  },

  evaluateCallState,
}
