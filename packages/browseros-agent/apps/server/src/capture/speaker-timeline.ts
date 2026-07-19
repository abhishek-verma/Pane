/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Active-speaker observations from meeting page UI, used to stamp ASR finals.
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface SpeakerObservation {
  displayName: string
  isLocalSelf?: boolean
  confidence: number
  observedAt: number
  source: string
  localSpeaking?: boolean
}

export interface ResolvedSpeaker {
  displayName: string
  isLocalSelf?: boolean
  confidence: number
  observedAt: number
}

const MAX_EVENTS = 120
const timelines = new Map<string, SpeakerObservation[]>()
const sessionDirs = new Map<string, string>()

/** Optional participant allowlist for hallucination guard (Phase C). */
const participantSets = new Map<string, Set<string>>()

export function bindSpeakerTimelineSession(
  sessionId: string,
  sessionDir: string,
): void {
  sessionDirs.set(sessionId, sessionDir)
}

export function recordSpeakerObservation(
  sessionId: string,
  obs: SpeakerObservation,
): void {
  if (!obs.displayName?.trim() || obs.confidence < 0.6) return

  let next = obs
  if (obs.localSpeaking && !obs.isLocalSelf) {
    next = applyMicSelfBoost(obs, true)
  }

  const name = next.displayName.trim()
  const allowed = participantSets.get(sessionId)
  if (allowed && allowed.size > 0) {
    const lower = name.toLowerCase()
    const inSet =
      allowed.has(lower) ||
      (Boolean(next.isLocalSelf) &&
        [...allowed].some((p) => p === lower || p === 'you'))
    if (!inSet && !next.isLocalSelf) {
      return
    }
  }

  const list = timelines.get(sessionId) ?? []
  list.push({ ...next, displayName: name })
  while (list.length > MAX_EVENTS) list.shift()
  timelines.set(sessionId, list)

  void appendSpeakerDebugLog(sessionId, { ...next, displayName: name }).catch(
    () => null,
  )
}

export function resolveSpeakerAt(
  sessionId: string,
  atMs: number,
  windowMs = 2_000,
): ResolvedSpeaker | null {
  const list = timelines.get(sessionId)
  if (!list?.length) return null

  let best: SpeakerObservation | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const obs of list) {
    const dist = Math.abs(obs.observedAt - atMs)
    if (dist > windowMs) continue
    if (dist < bestDist) {
      best = obs
      bestDist = dist
    }
  }
  if (!best) return null
  return {
    displayName: best.displayName,
    isLocalSelf: best.isLocalSelf,
    confidence: best.confidence,
    observedAt: best.observedAt,
  }
}

export function clearSpeakerTimeline(sessionId: string): void {
  timelines.delete(sessionId)
  participantSets.delete(sessionId)
  sessionDirs.delete(sessionId)
}

export function setSessionParticipants(
  sessionId: string,
  participants: Array<{ displayName: string }>,
): void {
  const set = new Set(
    participants.map((p) => p.displayName.trim().toLowerCase()).filter(Boolean),
  )
  if (set.size === 0) {
    participantSets.delete(sessionId)
  } else {
    participantSets.set(sessionId, set)
  }
}

/** Mic-energy correlation: boost self when localSpeaking is true. */
export function applyMicSelfBoost(
  obs: SpeakerObservation,
  localSpeaking: boolean | undefined,
): SpeakerObservation {
  if (!localSpeaking) return obs
  return {
    ...obs,
    isLocalSelf: true,
    confidence: Math.max(obs.confidence, 0.75),
  }
}

async function appendSpeakerDebugLog(
  sessionId: string,
  obs: SpeakerObservation,
): Promise<void> {
  const sessionDir = sessionDirs.get(sessionId)
  if (!sessionDir) return
  const path = join(sessionDir, 'speaker-events.jsonl')
  await mkdir(sessionDir, { recursive: true })
  await appendFile(path, `${JSON.stringify({ sessionId, ...obs })}\n`)
}
