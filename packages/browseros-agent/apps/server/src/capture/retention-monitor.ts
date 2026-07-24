/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { forEachKnownProfile } from '../lib/for-each-profile'
import { pruneCaptureRetention } from './performance'

let retentionTimer: ReturnType<typeof setInterval> | null = null

const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000

async function pruneAllProfiles(): Promise<void> {
  await forEachKnownProfile(async () => {
    await pruneCaptureRetention()
  })
}

export function startCaptureRetentionMonitor(): void {
  if (retentionTimer) return
  void pruneAllProfiles().catch(() => null)
  retentionTimer = setInterval(() => {
    void pruneAllProfiles().catch(() => null)
  }, RETENTION_INTERVAL_MS)
}

export function stopCaptureRetentionMonitor(): void {
  if (!retentionTimer) return
  clearInterval(retentionTimer)
  retentionTimer = null
}
