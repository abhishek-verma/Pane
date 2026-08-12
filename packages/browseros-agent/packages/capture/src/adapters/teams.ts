/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { MeetingCallState } from '../types'
import type {
  ActiveSpeakerObservation,
  MeetingDomProbe,
  MeetingSiteAdapter,
  ParticipantInfo,
} from './types'

const SPEAKER_CONFIDENCE_MIN = 0.6

function hasSelector(probe: MeetingDomProbe, selector: string): boolean {
  return probe.facts.matchedSelectors.includes(selector)
}

function ariaIncludes(probe: MeetingDomProbe, needle: string): boolean {
  const lower = needle.toLowerCase()
  return probe.facts.ariaLabels.some((l) => l.toLowerCase().includes(lower))
}

function evaluateCallState(probe: MeetingDomProbe): MeetingCallState {
  const text = probe.bodyText.toLowerCase()
  if (text.includes('join now') || text.includes('lobby')) return 'prejoin'
  if (hasSelector(probe, '[data-tid="call-hangup"]')) return 'in-call'
  // Require "hang up" or the specific hangup button — plain "leave" matches
  // too broadly (channel sidebar, file pickers, etc.)
  if (ariaIncludes(probe, 'hang up')) return 'in-call'
  if (probe.facts.hasVisibleLeaveControl) return 'in-call'
  if (probe.facts.hasVisibleMuteControl) return 'in-call'
  return 'prejoin'
}

function probeLocalMute(probe: MeetingDomProbe): boolean | null {
  const labels = probe.facts.ariaLabels.map((l) => l.toLowerCase())
  // Teams: "Unmute (Ctrl+Shift+M)" or "Mute (Ctrl+Shift+M)"
  if (labels.some((l) => l.startsWith('unmute'))) return true
  if (labels.some((l) => l.startsWith('mute') && !l.includes('unmute')))
    return false
  return null
}

function probeActiveSpeaker(
  probe: MeetingDomProbe,
): ActiveSpeakerObservation | null {
  const rows = probe.facts.captionRows
  if (rows?.length) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const name = rows[i]?.speaker.trim()
      if (!name) continue
      return {
        displayName: name,
        confidence: 0.95,
        observedAt: Date.now(),
        source: 'caption-row',
      }
    }
  }

  for (const c of probe.facts.speakingCandidates) {
    const name = c.name.trim()
    if (!name) continue
    const signals = new Set(c.signals.map((s) => s.toLowerCase()))
    let confidence = 0
    let source: ActiveSpeakerObservation['source'] = 'dom-tile'
    if (signals.has('caption-row')) {
      confidence = 0.95
      source = 'caption-row'
    } else if (signals.has('aria-speaking') || signals.has('speaking')) {
      confidence = 0.85
      source = 'dom-active'
    } else if (signals.has('border-active')) {
      confidence = 0.65
      source = 'dom-tile'
    }
    if (confidence < SPEAKER_CONFIDENCE_MIN) continue
    return {
      displayName: name,
      isLocalSelf: signals.has('self'),
      confidence,
      observedAt: Date.now(),
      source,
    }
  }
  return null
}

function probeParticipants(probe: MeetingDomProbe): ParticipantInfo[] {
  const seen = new Set<string>()
  const out: ParticipantInfo[] = []
  for (const c of probe.facts.speakingCandidates) {
    const name = c.name.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({
      displayName: name,
      isLocalSelf: c.signals.some((s) => s.toLowerCase() === 'self'),
    })
  }
  return out
}

export const teamsAdapter: MeetingSiteAdapter = {
  id: 'teams',
  displayName: 'Microsoft Teams',
  maturity: 'mature',
  defaultHosts: ['teams.microsoft.com', 'teams.live.com'],
  capabilities: ['roomDetection', 'callState', 'muteProbe', 'participantList'],

  matchesHost(hostname: string): boolean {
    return /^teams\.(microsoft|live)\.com$/i.test(hostname)
  },

  detectRoom(url: string): { roomKey: string } | null {
    try {
      const parsed = new URL(url)
      if (!this.matchesHost(parsed.hostname)) return null
      const path = parsed.pathname
      if (
        !(
          path.includes('/meetup-join/') ||
          path.includes('/meeting/') ||
          path.includes('/l/meetup-join/')
        )
      ) {
        return null
      }
      const parts = path.split('/').filter(Boolean)
      const marker = parts.findIndex(
        (p) => p === 'meetup-join' || p === 'meeting' || p === 'l',
      )
      const id =
        marker >= 0
          ? parts.slice(marker).join('/').toLowerCase()
          : path.toLowerCase()
      return { roomKey: `teams:${id}` }
    } catch {
      return null
    }
  },

  evaluateCallState,
  probeActiveSpeaker,
  probeParticipants,
  probeLocalMute,
}
