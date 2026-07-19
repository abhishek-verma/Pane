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
  if (
    text.includes('you have left the meeting') ||
    text.includes('meeting ended')
  ) {
    return 'left'
  }
  if (text.includes('join meeting') || text.includes('enter room')) {
    return 'prejoin'
  }
  if (
    text.includes('leave') ||
    ariaIncludes(probe, 'leave') ||
    hasSelector(probe, '[aria-label*="Leave"]')
  ) {
    return 'in-call'
  }
  return 'unknown'
}

export const webexAdapter: MeetingSiteAdapter = {
  id: 'webex',
  displayName: 'Webex',
  maturity: 'mature',
  defaultHosts: ['webex.com'],
  capabilities: ['roomDetection', 'callState'],

  matchesHost(hostname: string): boolean {
    return /^[a-z0-9-]+\.webex\.com$/i.test(hostname)
  },

  detectRoom(url: string): { roomKey: string } | null {
    try {
      const parsed = new URL(url)
      const host = parsed.hostname.toLowerCase()
      if (!this.matchesHost(host)) return null
      const path = parsed.pathname
      const meet = path.match(/^\/meet\/([^/]+)/i)
      if (meet?.[1]) {
        return { roomKey: `webex:${host}/${meet[1].toLowerCase()}` }
      }
      const join = path.match(/^\/join\/([^/]+)/i)
      if (join?.[1]) {
        return { roomKey: `webex:${host}/${join[1].toLowerCase()}` }
      }
      const mk =
        parsed.searchParams.get('MK') ?? parsed.searchParams.get('meetingKey')
      if (mk) {
        return { roomKey: `webex:${host}/${mk.toLowerCase()}` }
      }
      return null
    } catch {
      return null
    }
  },

  evaluateCallState,
}
