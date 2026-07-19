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

const GOOGLE_MEET_PLACEHOLDER_SEGMENTS = new Set([
  '',
  'landing',
  'new',
  'lookup',
  '_meet',
  'about',
])

const GOOGLE_MEET_ROOM = /^[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4}$/i

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
] as const

/** Post-call screens — must beat prejoin so capture stops after hangup. */
const GOOGLE_MEET_LEFT = [
  'you left the meeting',
  "you've left the meeting",
  'you left the call',
  "you've left the call",
  'return to home screen',
  'thanks for joining',
  'meeting has ended',
  'the meeting has ended',
  'call ended',
] as const

const SPEAKER_CONFIDENCE_MIN = 0.6
/** Caption-row speakers beat active-speaker tiles (OSS CC scrape pattern). */
const CAPTION_SPEAKER_CONFIDENCE = 0.95

function cleanSpeakerName(raw: string): string | null {
  const name = raw
    .replace(/\s+/g, ' ')
    .replace(/[•·]/g, ' ')
    .replace(/\((you|me)\)/gi, '')
    .replace(/\byou\b/gi, '')
    .replace(/^[-–—:\s]+|[-–—:\s]+$/g, '')
    .trim()
  if (!name) {
    if (/^you$/i.test(raw.trim())) return 'You'
    return null
  }
  // Caption scrapers sometimes grab the utterance as the "name".
  if (name.length > 48 || name.split(/\s+/).length > 5) return null
  if (/^(participant|captions?|transcript|someone)$/i.test(name)) return null
  return name
}

function evaluateCallState(probe: MeetingDomProbe): MeetingCallState {
  const text = probe.bodyText.toLowerCase()
  if (GOOGLE_MEET_LEFT.some((phrase) => text.includes(phrase))) return 'left'
  if (probe.facts.hasVisibleJoinControl) return 'prejoin'
  if (probe.pageTitle.trim().toLowerCase() === 'google meet') return 'prejoin'
  if (GOOGLE_MEET_PRE_JOIN.some((phrase) => text.includes(phrase))) {
    return 'prejoin'
  }
  // Prefer visible hangup control — bodyText often keeps stale "Leave call".
  if (probe.facts.hasVisibleLeaveControl) return 'in-call'
  const hasCallTimer = /\b\d{1,2}:\d{2}\b/.test(text)
  // Timer alone is weak; only count it when join UI is absent.
  if (hasCallTimer && !probe.facts.hasVisibleJoinControl) return 'in-call'
  return 'prejoin'
}

function observationFromCaption(
  probe: MeetingDomProbe,
): ActiveSpeakerObservation | null {
  const rows = probe.facts.captionRows
  if (!rows?.length) return null
  const selfName = probe.facts.selfName?.trim()
  // Prefer the most recent non-empty caption row with a clean speaker name
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!
    const cleaned = cleanSpeakerName(row.speaker)
    if (!cleaned) continue
    const isLocalSelf =
      (Boolean(selfName) &&
        cleaned.toLowerCase() === selfName!.toLowerCase()) ||
      /^you$/i.test(cleaned) ||
      /^you$/i.test(row.speaker.trim())
    return {
      displayName: isLocalSelf && selfName ? selfName : cleaned,
      isLocalSelf,
      confidence: CAPTION_SPEAKER_CONFIDENCE,
      observedAt: Date.now(),
      source: 'caption-row',
    }
  }
  return null
}

function probeActiveSpeaker(
  probe: MeetingDomProbe,
): ActiveSpeakerObservation | null {
  // P1: platform CC binds speaker to text — prefer over tile heuristics
  const fromCaption = observationFromCaption(probe)
  if (fromCaption) return fromCaption

  const selfName = probe.facts.selfName?.trim()
  const candidates = probe.facts.speakingCandidates

  let best: {
    name: string
    confidence: number
    source: ActiveSpeakerObservation['source']
    isLocalSelf?: boolean
  } | null = null

  for (const c of candidates) {
    const name = cleanSpeakerName(c.name)
    if (!name) continue
    const signals = new Set(c.signals.map((s) => s.toLowerCase()))
    // caption-row without captionRows payload still scores high if collected as candidate
    let confidence = 0
    let source: ActiveSpeakerObservation['source'] = 'dom-tile'
    if (signals.has('caption-row')) {
      confidence = CAPTION_SPEAKER_CONFIDENCE
      source = 'caption-row'
    } else if (signals.has('aria-speaking') || signals.has('speaking')) {
      confidence = 0.85
      source = 'dom-active'
    } else if (signals.has('presenting')) {
      confidence = 0.8
      source = 'dom-active'
    } else if (signals.has('border-active') || signals.has('highlighted')) {
      confidence = 0.65
      source = 'dom-tile'
    }
    if (confidence < SPEAKER_CONFIDENCE_MIN) continue
    const isLocalSelf =
      signals.has('self') ||
      (Boolean(selfName) && name.toLowerCase() === selfName!.toLowerCase()) ||
      /^you$/i.test(name)
    if (!best || confidence > best.confidence) {
      best = { name, confidence, source, isLocalSelf }
    }
  }

  if (!best) return null
  return {
    displayName: best.isLocalSelf && selfName ? selfName : best.name,
    isLocalSelf: best.isLocalSelf,
    confidence: best.confidence,
    observedAt: Date.now(),
    source: best.source,
  }
}

function probeParticipants(probe: MeetingDomProbe): ParticipantInfo[] {
  const seen = new Set<string>()
  const out: ParticipantInfo[] = []
  const selfName = probe.facts.selfName?.trim()

  for (const a of probe.facts.attendees ?? []) {
    const name = a.displayName.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({
      displayName: name,
      isLocalSelf:
        a.isLocalSelf ||
        (Boolean(selfName) && name.toLowerCase() === selfName!.toLowerCase()),
    })
  }

  for (const row of probe.facts.captionRows ?? []) {
    const name = row.speaker.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({
      displayName: name,
      isLocalSelf:
        Boolean(selfName) && name.toLowerCase() === selfName!.toLowerCase(),
    })
  }

  for (const c of probe.facts.speakingCandidates) {
    const name = c.name.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({
      displayName: name,
      isLocalSelf:
        Boolean(selfName) && name.toLowerCase() === selfName!.toLowerCase(),
    })
  }
  if (selfName && !seen.has(selfName.toLowerCase())) {
    out.unshift({ displayName: selfName, isLocalSelf: true })
  }
  return out
}

function probeLocalMute(probe: MeetingDomProbe): boolean | null {
  const labels = probe.facts.ariaLabels.map((l) => l.toLowerCase())
  if (labels.some((l) => l.includes('turn on microphone'))) return true
  if (labels.some((l) => l.includes('turn off microphone'))) return false
  return null
}

export const meetAdapter: MeetingSiteAdapter = {
  id: 'meet',
  displayName: 'Google Meet',
  maturity: 'mature',
  defaultHosts: ['meet.google.com'],
  capabilities: [
    'roomDetection',
    'callState',
    // speakerLabels disabled for now — DOM stamps were unreliable in dogfood.
    'muteProbe',
    'participantList',
  ],

  matchesHost(hostname: string): boolean {
    return hostname.toLowerCase() === 'meet.google.com'
  },

  detectRoom(url: string): { roomKey: string } | null {
    try {
      const parsed = new URL(url)
      if (!this.matchesHost(parsed.hostname)) return null
      const segment =
        parsed.pathname.replace(/^\//, '').split('/')[0]?.split('?')[0] ?? ''
      if (GOOGLE_MEET_PLACEHOLDER_SEGMENTS.has(segment.toLowerCase())) {
        return null
      }
      if (!GOOGLE_MEET_ROOM.test(segment)) return null
      return { roomKey: `meet:${segment.toLowerCase()}` }
    } catch {
      return null
    }
  },

  evaluateCallState,
  probeActiveSpeaker,
  probeParticipants,
  probeLocalMute,
}
