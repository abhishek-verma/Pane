/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { MeetingCallState } from '../types'
import type { MeetingDomProbe, MeetingSiteAdapter } from './types'

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
  // Use visible controls rather than broad text/aria matching to avoid
  // false positives on pages that contain "leave" in unrelated contexts.
  if (probe.facts.hasVisibleLeaveControl) return 'in-call'
  if (probe.facts.hasVisibleMuteControl) return 'in-call'
  return 'unknown'
}

function probeLocalMute(probe: MeetingDomProbe): boolean | null {
  const labels = probe.facts.ariaLabels.map((l) => l.toLowerCase())
  // Webex: "Mute" / "Unmute" in the meeting control bar
  if (labels.some((l) => l === 'unmute' || l.startsWith('unmute '))) return true
  if (
    labels.some(
      (l) => (l === 'mute' || l.startsWith('mute ')) && !l.includes('unmute'),
    )
  )
    return false
  return null
}

export const webexAdapter: MeetingSiteAdapter = {
  id: 'webex',
  displayName: 'Webex',
  maturity: 'mature',
  defaultHosts: ['webex.com'],
  capabilities: ['roomDetection', 'callState', 'muteProbe'],

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
  probeLocalMute,
}
