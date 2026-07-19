/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Conservative energy gate for ASR enqueue only. Never drops disk audio.
 * Forced-ASR bypass when sustained energy produces no transcript.
 */

const SILENCE_RMS = 0.008
const FORCE_AFTER_MS = 4_000

const energyWithoutText = new Map<
  string,
  { since: number; lastTextAt: number }
>()

/** Rough PCM RMS from raw chunk bytes (WebM is opaque — use byte energy proxy). */
export function estimateChunkEnergy(data: Uint8Array): number {
  if (data.length === 0) return 0
  let sum = 0
  const step = Math.max(1, Math.floor(data.length / 2_000))
  let n = 0
  for (let i = 0; i < data.length; i += step) {
    const v = (data[i]! - 128) / 128
    sum += v * v
    n++
  }
  return Math.sqrt(sum / Math.max(1, n))
}

/**
 * Returns whether ASR should run for this chunk.
 * Disk persist always happens regardless.
 */
export function shouldEnqueueAsr(input: {
  sessionId: string
  energy: number
  force?: boolean
  now?: number
}): { enqueue: boolean; forced: boolean } {
  if (input.force) return { enqueue: true, forced: true }
  const now = input.now ?? Date.now()
  const state = energyWithoutText.get(input.sessionId) ?? {
    since: now,
    lastTextAt: 0,
  }

  if (input.energy < SILENCE_RMS) {
    energyWithoutText.set(input.sessionId, state)
    return { enqueue: false, forced: false }
  }

  if (state.lastTextAt === 0 && state.since === 0) {
    state.since = now
  }
  if (now - state.since >= FORCE_AFTER_MS && state.lastTextAt < state.since) {
    energyWithoutText.set(input.sessionId, state)
    return { enqueue: true, forced: true }
  }
  energyWithoutText.set(input.sessionId, state)
  return { enqueue: true, forced: false }
}

export function noteAsrText(sessionId: string, now = Date.now()): void {
  const state = energyWithoutText.get(sessionId) ?? {
    since: now,
    lastTextAt: now,
  }
  state.lastTextAt = now
  state.since = now
  energyWithoutText.set(sessionId, state)
}

export function resetVadForTests(): void {
  energyWithoutText.clear()
}
