/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { MeetingCallState } from '../types'
import { resolveAttendeeDisplayName } from './attendee-map'
import type {
  ActiveSpeakerObservation,
  MeetingDomProbe,
  MeetingSiteAdapter,
  ParticipantInfo,
} from './types'

const SPEAKER_CONFIDENCE_MIN = 0.6
const CAPTION_SPEAKER_CONFIDENCE = 0.95

function hasSelector(probe: MeetingDomProbe, selector: string): boolean {
  return probe.facts.matchedSelectors.includes(selector)
}

function evaluateCallState(probe: MeetingDomProbe): MeetingCallState {
  const inMeeting =
    hasSelector(probe, '#meeting-client') ||
    hasSelector(probe, '.meeting-app') ||
    hasSelector(probe, '#wc-container')
  const hasJoin =
    hasSelector(probe, '#join-btn') || hasSelector(probe, '.join-meeting')
  return inMeeting && !hasJoin ? 'in-call' : 'prejoin'
}

function resolveName(
  raw: string,
  probe: MeetingDomProbe,
): { displayName: string; isLocalSelf?: boolean } {
  const hit = resolveAttendeeDisplayName(raw, probe.facts.attendees ?? [])
  return {
    displayName: hit.displayName,
    isLocalSelf: hit.isLocalSelf,
  }
}

function probeActiveSpeaker(
  probe: MeetingDomProbe,
): ActiveSpeakerObservation | null {
  const rows = probe.facts.captionRows
  if (rows?.length) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]!
      const name = row.speaker.trim()
      if (!name) continue
      const resolved = resolveName(name, probe)
      return {
        displayName: resolved.displayName,
        isLocalSelf: resolved.isLocalSelf,
        confidence: CAPTION_SPEAKER_CONFIDENCE,
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
      confidence = CAPTION_SPEAKER_CONFIDENCE
      source = 'caption-row'
    } else if (signals.has('aria-speaking') || signals.has('speaking')) {
      confidence = 0.85
      source = 'dom-active'
    } else if (signals.has('border-active')) {
      confidence = 0.65
      source = 'dom-tile'
    }
    if (confidence < SPEAKER_CONFIDENCE_MIN) continue
    const resolved = resolveName(name, probe)
    return {
      displayName: resolved.displayName,
      isLocalSelf: resolved.isLocalSelf ?? signals.has('self'),
      confidence:
        resolved.displayName !== name
          ? Math.min(1, confidence + 0.05)
          : confidence,
      observedAt: Date.now(),
      source,
    }
  }
  return null
}

function probeLocalMute(probe: MeetingDomProbe): boolean | null {
  const labels = probe.facts.ariaLabels.map((l) => l.toLowerCase())
  if (labels.some((l) => l.includes('unmute'))) return true
  if (labels.some((l) => /\bmute\b/.test(l) && !l.includes('unmute'))) {
    return false
  }
  return null
}

function probeParticipants(probe: MeetingDomProbe): ParticipantInfo[] {
  const seen = new Set<string>()
  const out: ParticipantInfo[] = []
  for (const a of probe.facts.attendees ?? []) {
    const name = a.displayName.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({
      displayName: name,
      isLocalSelf: a.isLocalSelf,
    })
  }
  for (const c of probe.facts.speakingCandidates) {
    const raw = c.name.trim()
    if (!raw) continue
    const resolved = resolveName(raw, probe)
    if (seen.has(resolved.displayName.toLowerCase())) continue
    seen.add(resolved.displayName.toLowerCase())
    out.push({
      displayName: resolved.displayName,
      isLocalSelf:
        resolved.isLocalSelf ||
        c.signals.some((s) => s.toLowerCase() === 'self'),
    })
  }
  return out
}

export const zoomAdapter: MeetingSiteAdapter = {
  id: 'zoom',
  displayName: 'Zoom',
  maturity: 'mature',
  defaultHosts: ['zoom.us'],
  capabilities: [
    'roomDetection',
    'callState',
    // speakerLabels disabled for now

    'muteProbe',
    'participantList',
  ],

  matchesHost(hostname: string): boolean {
    return /^[a-z0-9-]+\.zoom\.us$/i.test(hostname)
  },

  detectRoom(url: string): { roomKey: string } | null {
    try {
      const parsed = new URL(url)
      if (!this.matchesHost(parsed.hostname)) return null
      const path = parsed.pathname
      const j = path.match(/^\/(?:j|wc)\/(\d+)/i)
      if (j?.[1]) return { roomKey: `zoom:${j[1]}` }
      if (/\/join/i.test(path)) {
        const id = parsed.searchParams.get('confno') ?? path
        return { roomKey: `zoom:${id.toLowerCase()}` }
      }
      return null
    } catch {
      return null
    }
  },

  evaluateCallState,
  probeActiveSpeaker,
  probeParticipants,
  probeLocalMute,
}
