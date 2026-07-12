/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { detectOnBattery, getPauseOnBatteryPref } from '../context/battery'
import { getCaptureDir } from '../lib/browseros-dir'
import { activeCaptureSessionCount } from './meeting-pipeline'

export const DEFAULT_RAW_RETENTION_DAYS = 7
export const DEFAULT_TRANSCRIPT_RETENTION_DAYS = 90
export const DEFAULT_DISK_PAUSE_BYTES = 5 * 1024 * 1024 * 1024

let pausedReason: 'battery' | 'disk' | 'load' | null = null

export function setCapturePausedReason(
  reason: 'battery' | 'disk' | 'load' | null,
): void {
  pausedReason = reason
}

export function getCapturePausedReason(): 'battery' | 'disk' | 'load' | null {
  return pausedReason
}

export function assertCaptureNotPaused(): void {
  if (pausedReason) {
    throw new Error(`Capture paused (${pausedReason})`)
  }
}

export async function refreshCapturePauseState(): Promise<void> {
  const pauseCaptureOnBattery =
    getPauseOnBatteryPref() &&
    process.env.BROWSEROS_CAPTURE_PAUSE_BATTERY !== 'false'
  if (pauseCaptureOnBattery) {
    const onBattery = await detectOnBattery()
    if (onBattery === true) {
      pausedReason = 'battery'
      return
    }
  }
  const diskUsageBytes = await directorySize(getCaptureDir())
  if (diskUsageBytes > DEFAULT_DISK_PAUSE_BYTES) {
    pausedReason = 'disk'
    return
  }
  if (activeCaptureSessionCount() > 2) {
    pausedReason = 'load'
    return
  }
  if (
    pausedReason === 'battery' ||
    pausedReason === 'disk' ||
    pausedReason === 'load'
  ) {
    pausedReason = null
  }
}

export async function getCaptureStatus(): Promise<{
  paused: boolean
  reason: 'battery' | 'disk' | 'load' | null
  diskUsageBytes: number
  activeSessions: number
}> {
  await refreshCapturePauseState()
  return {
    paused: pausedReason !== null,
    reason: pausedReason,
    diskUsageBytes: await directorySize(getCaptureDir()),
    activeSessions: activeCaptureSessionCount(),
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
    const fullPath = join(path, entry)
    const info = await stat(fullPath)
    if (info.isDirectory()) {
      yield* walk(fullPath)
    } else {
      yield fullPath
    }
  }
}
