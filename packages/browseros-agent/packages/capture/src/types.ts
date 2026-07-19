/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type CaptureClass = 'meeting' | 'browsing' | 'research'
export type CaptureSessionStatus =
  | 'active'
  | 'interrupted'
  | 'paused'
  | 'stopped'
  | 'error'
export type TranscriptionProviderId =
  | 'local-faster-whisper'
  | 'openai-byok'
  | 'deepgram-byok'
export type MeetingSite =
  | 'meet'
  | 'zoom'
  | 'teams'
  | 'slack'
  | 'webex'
  | 'generic'
export type CaptureAudioTrack = 'mixed' | 'mic'
export type MeetingCallState = 'prejoin' | 'in-call' | 'left' | 'unknown'

export interface AudioChunk {
  sessionId: string
  sequence: number
  mimeType: string
  data: Uint8Array
  capturedAt: number
  track?: CaptureAudioTrack
}

export interface TranscriptSegment {
  id: string
  sessionId: string
  kind: 'partial' | 'final' | 'gap'
  text?: string
  startedAtMs?: number
  endedAtMs?: number
  capturedAt: number
  speaker?: string
  confidence?: number
  reason?: string
  resumeSequence?: number
}

export interface CaptureStatus {
  paused: boolean
  reason: 'battery' | 'disk' | 'load' | null
  /** True when new meetings may be refused, but active chunk persist still works. */
  refuseNewSessions: boolean
  /** True when ASR enqueue is deferred (audio still persisted). */
  asrDeferred: boolean
  diskUsageBytes: number
  activeSessions: number
}

export interface TranscriptionSession {
  feedChunk(chunk: AudioChunk): Promise<void>
  stop(): Promise<void>
}

export interface TranscriptionProvider {
  id: TranscriptionProviderId
  startSession(input: {
    sessionId: string
    language?: string
    onPartial: (segment: TranscriptSegment) => void
    onFinal: (segment: TranscriptSegment) => void
  }): Promise<TranscriptionSession>
}

export interface DetectedMeetingRoom {
  site: MeetingSite
  roomKey: string
}
