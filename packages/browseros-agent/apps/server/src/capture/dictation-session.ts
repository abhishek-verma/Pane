/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * In-memory session bookkeeping for live dictation captions. Deliberately
 * decoupled from meeting-pipeline.ts (no DB, consent, or speaker-timeline
 * machinery) — dictation sessions are short-lived and single-user.
 */

import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TranscriptSegment } from '@browseros/capture/types'
import { logger } from '../lib/logger'
import { registerAsrSession, unregisterAsrSession } from './shared-asr-worker'
import { publishCaptureEvent } from './transcript-events'

export interface DictationSegment {
  text: string
  cumulative: string
}

export interface DictationSession {
  tmpPath: string
  sequence: number
  segments: DictationSegment[]
  registered: boolean
  lastActivityAt: number
}

const sessions = new Map<string, DictationSession>()

// Well above the ~10s steady-state feed cadence, so this never fires on a
// healthy session — only on one whose client vanished (crashed tab, killed
// process) before it could DELETE or send a final feed.
const IDLE_SWEEP_INTERVAL_MS = 30_000
const IDLE_SESSION_TTL_MS = 90_000

export function getOrCreateDictationSession(
  sessionId: string,
): DictationSession {
  const existing = sessions.get(sessionId)
  if (existing) return existing
  const session: DictationSession = {
    tmpPath: join(tmpdir(), `pane-dictation-${randomUUID()}.webm`),
    sequence: 0,
    segments: [],
    registered: false,
    lastActivityAt: Date.now(),
  }
  sessions.set(sessionId, session)
  return session
}

// Every helper below takes the DictationSession object a route handler
// already resolved via getOrCreateDictationSession, instead of re-resolving
// it from `sessionId` again — a second independent lookup mid-request could
// otherwise silently recreate a brand-new session (fresh tmpPath, empty
// segments, orphaned ASR registration) if a concurrent DELETE tore down the
// original between the two lookups.

export function touchDictationSession(session: DictationSession): void {
  session.lastActivityAt = Date.now()
}

export async function ensureAsrRegistered(
  sessionId: string,
  session: DictationSession,
): Promise<void> {
  if (session.registered) return
  session.registered = true
  await registerAsrSession(sessionId, {
    onPartial: () => {},
    onFinal: (seg: TranscriptSegment) => {
      const text = seg.text?.trim()
      if (!text) return
      const prior = session.segments.at(-1)?.cumulative
      const cumulative = prior ? `${prior} ${text}`.trim() : text
      session.segments.push({ text, cumulative })
      publishCaptureEvent(sessionId, {
        type: 'segment',
        segment: { ...seg, text },
      })
    },
  })
}

export function nextSequence(session: DictationSession): number {
  const seq = session.sequence
  session.sequence += 1
  return seq
}

export function getDictationSegments(
  session: DictationSession,
): DictationSegment[] {
  return session.segments
}

export async function closeDictationSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId)
  if (!session) return
  sessions.delete(sessionId)
  await unregisterAsrSession(sessionId)
  await unlink(session.tmpPath).catch(() => {})
}

const idleSweepTimer = setInterval(() => {
  const now = Date.now()
  for (const [sessionId, session] of sessions) {
    if (now - session.lastActivityAt < IDLE_SESSION_TTL_MS) continue
    logger.warn('Reaping idle dictation session', { sessionId })
    void closeDictationSession(sessionId)
  }
}, IDLE_SWEEP_INTERVAL_MS)
idleSweepTimer.unref?.()

/** Test helper: clear in-memory state between cases. */
export function resetDictationSessionsForTests(): void {
  sessions.clear()
}
