/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type CaptureClass = 'meeting' | 'browsing' | 'research'
export type CaptureSessionStatus = 'active' | 'paused' | 'stopped' | 'error'
export type TranscriptionProviderId =
  | 'local-faster-whisper'
  | 'openai-byok'
  | 'deepgram-byok'

export interface AudioChunk {
  sessionId: string
  sequence: number
  mimeType: string
  data: Uint8Array
  capturedAt: number
}

export interface TranscriptSegment {
  id: string
  sessionId: string
  kind: 'partial' | 'final'
  text: string
  startedAtMs?: number
  endedAtMs?: number
  capturedAt: number
  speaker?: string
}

export interface CaptureStatus {
  paused: boolean
  reason: 'battery' | 'disk' | 'load' | null
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
