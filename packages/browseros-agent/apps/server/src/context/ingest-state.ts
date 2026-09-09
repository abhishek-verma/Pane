/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

let ingestPaused = false
let pauseReason: string | null = null

/** Test / M3.7 hook: pause non-critical ingest (e.g. on battery). */
export function setIngestPaused(paused: boolean, reason?: string): void {
  ingestPaused = paused
  pauseReason = paused ? (reason ?? 'paused') : null
}

export function isIngestPaused(): boolean {
  return ingestPaused
}

export function getIngestPauseReason(): string | null {
  return pauseReason
}
