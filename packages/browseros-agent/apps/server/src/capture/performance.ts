/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Admission split:
 * - New sessions may be refused (battery/disk/load).
 * - Chunk persist for active sessions is never blocked.
 * - ASR enqueue may be deferred when load-saturated.
 */

import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { detectOnBattery, getPauseOnBatteryPref } from '../context/battery'
import { getCaptureDir } from '../lib/browseros-dir'
import { registeredAsrSessionCount } from './shared-asr-worker'

export const DEFAULT_RAW_RETENTION_DAYS = 7
export const DEFAULT_TRANSCRIPT_RETENTION_DAYS = 90
export const DEFAULT_DISK_PAUSE_BYTES = 5 * 1024 * 1024 * 1024
export const MAX_CONCURRENT_MEETINGS = 2

let refuseNewReason: 'battery' | 'disk' | 'load' | null = null
let asrDeferred = false

/** @deprecated Use getRefuseNewSessionsReason — kept for callers that expect pause. */
export function setCapturePausedReason(
  reason: 'battery' | 'disk' | 'load' | null,
): void {
  refuseNewReason = reason
}

export function getCapturePausedReason(): 'battery' | 'disk' | 'load' | null {
  return refuseNewReason
}

export function getRefuseNewSessionsReason():
  | 'battery'
  | 'disk'
  | 'load'
  | null {
  return refuseNewReason
}

export function isAsrDeferredGlobally(): boolean {
  return asrDeferred
}

/** Throws only when starting a *new* meeting should be refused. */
export function assertCanStartNewCapture(): void {
  if (refuseNewReason) {
    throw new Error(`Capture paused (${refuseNewReason})`)
  }
}

/** @deprecated Do not use on chunk persist path. */
export function assertCaptureNotPaused(): void {
  assertCanStartNewCapture()
}

export async function refreshCapturePauseState(): Promise<void> {
  const pauseCaptureOnBattery =
    getPauseOnBatteryPref() &&
    process.env.BROWSEROS_CAPTURE_PAUSE_BATTERY !== 'false'
  if (pauseCaptureOnBattery) {
    const onBattery = await detectOnBattery()
    if (onBattery === true) {
      refuseNewReason = 'battery'
      asrDeferred = true
      return
    }
  }
  const diskUsageBytes = await directorySize(getCaptureDir())
  if (diskUsageBytes > DEFAULT_DISK_PAUSE_BYTES) {
    refuseNewReason = 'disk'
    asrDeferred = true
    return
  }
  const active = registeredAsrSessionCount()
  if (active > MAX_CONCURRENT_MEETINGS) {
    refuseNewReason = 'load'
    asrDeferred = true
    return
  }
  // At capacity for new sessions, but ASR still runs for existing.
  if (active >= MAX_CONCURRENT_MEETINGS) {
    refuseNewReason = 'load'
    asrDeferred = false
    return
  }
  refuseNewReason = null
  asrDeferred = false
}

export async function getCaptureStatus(): Promise<{
  paused: boolean
  reason: 'battery' | 'disk' | 'load' | null
  refuseNewSessions: boolean
  asrDeferred: boolean
  diskUsageBytes: number
  activeSessions: number
}> {
  await refreshCapturePauseState()
  return {
    paused: refuseNewReason !== null,
    reason: refuseNewReason,
    refuseNewSessions: refuseNewReason !== null,
    asrDeferred,
    diskUsageBytes: await directorySize(getCaptureDir()),
    activeSessions: registeredAsrSessionCount(),
  }
}

export async function pruneCaptureRetention(
  options: { rawRetentionDays?: number; transcriptRetentionDays?: number } = {},
): Promise<{ removed: number }> {
  const rawCutoff =
    Date.now() -
    (options.rawRetentionDays ?? DEFAULT_RAW_RETENTION_DAYS) *
      24 *
      60 *
      60 *
      1000
  let removed = 0
  for await (const path of walk(getCaptureDir())) {
    if (!path.includes('/audio-chunks/')) continue
    const info = await stat(path)
    if (info.mtimeMs < rawCutoff) {
      await rm(path, { force: true })
      removed++
    }
  }
  return { removed }
}

async function directorySize(path: string): Promise<number> {
  let total = 0
  try {
    for await (const file of walk(path)) {
      total += (await stat(file)).size
    }
  } catch {
    return 0
  }
  return total
}

async function* walk(path: string): AsyncGenerator<string> {
  let entries: string[]
  try {
    entries = await readdir(path)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(path, entry)
    try {
      const info = await stat(full)
      if (info.isDirectory()) yield* walk(full)
      else yield full
    } catch {
      /* ignore */
    }
  }
}
