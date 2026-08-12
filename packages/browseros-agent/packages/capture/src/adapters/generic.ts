/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Manual domains: best-effort room id + call state; never invents `left`.
 */

import type { MeetingCallState } from '../types'
import type {
  ActiveSpeakerObservation,
  MeetingDomProbe,
  MeetingSiteAdapter,
} from './types'

/** Wait this long on `unknown` before auto-start (bridge). */
export const GENERIC_UNKNOWN_START_MS = 8_000

const SPEAKER_CONFIDENCE_MIN = 0.6

function evaluateCallState(probe: MeetingDomProbe): MeetingCallState {
  const text = probe.bodyText.toLowerCase()
  if (
    text.includes('you left the meeting') ||
    text.includes('meeting ended') ||
    text.includes('call ended')
  ) {
    // Still prefer unknown over false left for arbitrary sites.
    return 'unknown'
  }
  if (
    text.includes('leave call') ||
    text.includes('leave meeting') ||
    text.includes('end call') ||
    /\b\d{1,2}:\d{2}\b/.test(text)
  ) {
    return 'in-call'
  }
  if (text.includes('join now') || text.includes('join meeting')) {
    return 'prejoin'
  }
  return 'unknown'
}

function probeActiveSpeaker(
  probe: MeetingDomProbe,
): ActiveSpeakerObservation | null {
  for (const c of probe.facts.speakingCandidates) {
    const name = c.name.trim()
    if (!name || /^participant$/i.test(name)) continue
    const signals = new Set(c.signals.map((s) => s.toLowerCase()))
    let confidence = 0
    if (signals.has('aria-speaking') || signals.has('speaking')) {
      confidence = 0.7
    } else if (signals.has('border-active')) {
      confidence = 0.6
    }
    if (confidence < SPEAKER_CONFIDENCE_MIN) continue
    return {
      displayName: name,
      isLocalSelf: signals.has('self'),
      confidence,
      observedAt: Date.now(),
      source: 'generic-heuristic',
    }
  }
  return null
}

export const genericAdapter: MeetingSiteAdapter = {
  id: 'generic',
  displayName: 'Other site',
  maturity: 'generic',
  status: 'stable',
  defaultHosts: [],
  capabilities: ['roomDetection', 'callState'],

  matchesHost(_hostname: string): boolean {
    // Resolved only via consent allowlist in resolveCaptureAdapter.
    return false
  },

  detectRoom(url: string): { roomKey: string } | null {
    try {
      const parsed = new URL(url)
      const host = parsed.hostname.toLowerCase()
      const path = parsed.pathname || '/'
      return { roomKey: `generic:${host}${path}`.toLowerCase() }
    } catch {
      return null
    }
  },

  evaluateCallState,
  probeActiveSpeaker,
}
