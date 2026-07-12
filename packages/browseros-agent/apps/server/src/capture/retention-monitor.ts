/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { pruneCaptureRetention } from './performance'

let retentionTimer: ReturnType<typeof setInterval> | null = null

const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000

export function startCaptureRetentionMonitor(): void {
  if (retentionTimer) return
  void pruneCaptureRetention().catch(() => null)
  retentionTimer = setInterval(() => {
    void pruneCaptureRetention().catch(() => null)
  }, RETENTION_INTERVAL_MS)
}

export function stopCaptureRetentionMonitor(): void {
  if (!retentionTimer) return
  clearInterval(retentionTimer)
  retentionTimer = null
}
