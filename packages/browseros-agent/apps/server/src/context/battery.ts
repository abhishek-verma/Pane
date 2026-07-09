/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Best-effort battery detection for pausing non-critical graph ingest.
 * On macOS uses `pmset -g batt` (cached 30s). If detection fails, respects
 * the `context.ingest.pauseOnBattery` preference (default true) only when
 * a positive on-battery signal is observed.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from '../lib/logger'
import { setIngestPaused } from './ingest'

const execFileAsync = promisify(execFile)

let cached: { at: number; onBattery: boolean } | null = null
const CACHE_MS = 30_000
let pauseOnBatteryPref = true
let monitorTimer: ReturnType<typeof setInterval> | null = null

export function setPauseOnBatteryPref(enabled: boolean): void {
  pauseOnBatteryPref = enabled
  void refreshBatteryIngestPause()
}

export function getPauseOnBatteryPref(): boolean {
  return pauseOnBatteryPref
}

/** Parse `pmset -g batt` output. Returns null if unknown. */
export function parsePmsetBattery(output: string): boolean | null {
  const lower = output.toLowerCase()
  if (lower.includes('ac power') || lower.includes("from 'ac power'")) {
    return false
  }
  if (
    lower.includes('battery power') ||
    lower.includes("from 'battery power'")
  ) {
    return true
  }
  // Heuristic: "discharging" without AC
  if (lower.includes('discharging') && !lower.includes('ac power')) {
    return true
  }
  if (lower.includes('charging') || lower.includes('charged')) {
    return false
  }
  return null
}

export async function detectOnBattery(): Promise<boolean | null> {
  if (process.platform !== 'darwin') {
    return null
  }
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) {
    return cached.onBattery
  }
  try {
    const { stdout } = await execFileAsync('pmset', ['-g', 'batt'], {
      timeout: 2000,
    })
    const onBattery = parsePmsetBattery(stdout)
    if (onBattery != null) {
      cached = { at: now, onBattery }
      return onBattery
    }
    return null
  } catch (error) {
    logger.warn('battery detection failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function refreshBatteryIngestPause(): Promise<void> {
  if (!pauseOnBatteryPref) {
    setIngestPaused(false)
    return
  }
  const onBattery = await detectOnBattery()
  if (onBattery === true) {
    setIngestPaused(true, 'battery')
  } else if (onBattery === false) {
    setIngestPaused(false)
  }
  // null = unknown: leave current pause state (honest limitation)
}

/** Start a light poller (every 60s). Idempotent. */
export function startBatteryIngestMonitor(): void {
  if (monitorTimer) return
  void refreshBatteryIngestPause()
  monitorTimer = setInterval(() => {
    void refreshBatteryIngestPause()
  }, 60_000)
}
