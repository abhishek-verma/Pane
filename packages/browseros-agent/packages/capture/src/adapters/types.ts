/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { MeetingCallState, MeetingSite } from '../types'

export type AdapterCapability =
  | 'roomDetection'
  | 'callState'
  | 'speakerLabels'
  | 'muteProbe'
  | 'participantList'

export type MeetingSiteId = MeetingSite

export interface CaptionRowFact {
  speaker: string
  text: string
}

export interface AttendeeFact {
  displayName: string
  initials?: string
  isLocalSelf?: boolean
}

export interface MeetingDomFacts {
  matchedSelectors: string[]
  ariaLabels: string[]
  speakingCandidates: Array<{
    name: string
    signals: string[]
  }>
  selfName?: string
  /**
   * Rows from the platform closed-caption panel when CC is on.
   * Highest-confidence speaker source (OSS Meet-Note-Taker / TranscripTonic pattern).
   */
  captionRows?: CaptionRowFact[]
  /** Participant roster for name resolution (Zoom initials → full name). */
  attendees?: AttendeeFact[]
  /** Visible hangup / leave control — preferred over bodyText for in-call. */
  hasVisibleLeaveControl?: boolean
  /** Visible join control (pre-call). */
  hasVisibleJoinControl?: boolean
}

export interface MeetingDomProbe {
  hostname: string
  href: string
  bodyText: string
  pageTitle: string
  facts: MeetingDomFacts
}

export interface ActiveSpeakerObservation {
  displayName: string
  isLocalSelf?: boolean
  confidence: number
  observedAt: number
  source: 'caption-row' | 'dom-active' | 'dom-tile' | 'generic-heuristic'
}

export interface ParticipantInfo {
  displayName: string
  isLocalSelf?: boolean
}

export interface MeetingSiteAdapter {
  id: MeetingSiteId
  displayName: string
  maturity: 'mature' | 'generic'
  defaultHosts: string[]
  capabilities: AdapterCapability[]

  matchesHost(hostname: string): boolean
  detectRoom(url: string): { roomKey: string } | null
  evaluateCallState(probe: MeetingDomProbe): MeetingCallState
  probeActiveSpeaker?(probe: MeetingDomProbe): ActiveSpeakerObservation | null
  probeParticipants?(probe: MeetingDomProbe): ParticipantInfo[]
  probeLocalMute?(probe: MeetingDomProbe): boolean | null
}

/** Display metadata for Settings (JSON-safe). */
export interface MatureAdapterMeta {
  id: MeetingSiteId
  displayName: string
  defaultHosts: string[]
  capabilities: AdapterCapability[]
}
