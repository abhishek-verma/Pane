/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** Quiet hours for reach outbound. Defaults: 22:00–08:00 local. */
export const DEFAULT_QUIET_START_HOUR = 22
export const DEFAULT_QUIET_END_HOUR = 8
export const DEFAULT_REACH_MAX_PER_DAY = 20

export interface QuietHoursConfig {
  startHour: number
  endHour: number
  enabled: boolean
}

let quietConfig: QuietHoursConfig = {
  startHour: DEFAULT_QUIET_START_HOUR,
  endHour: DEFAULT_QUIET_END_HOUR,
  enabled: true,
}

export function getQuietHoursConfig(): QuietHoursConfig {
  return { ...quietConfig }
}

export function setQuietHoursConfig(patch: Partial<QuietHoursConfig>): void {
  quietConfig = { ...quietConfig, ...patch }
}

/**
 * Quiet window that may wrap midnight (e.g. 22→8).
 * Returns true when outbound should be suppressed.
 */
export function isInQuietHours(
  now: Date = new Date(),
  config: QuietHoursConfig = quietConfig,
): boolean {
  if (!config.enabled) return false
  const h = now.getHours()
  const { startHour, endHour } = config
  if (startHour === endHour) return false
  if (startHour < endHour) {
    return h >= startHour && h < endHour
  }
  // wraps midnight
  return h >= startHour || h < endHour
}

/** Simple in-memory daily rate limit for reach outbound. */
const sendCounts = new Map<string, { day: string; count: number }>()

function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function canSendReach(
  transportId: string,
  maxPerDay = DEFAULT_REACH_MAX_PER_DAY,
  now = new Date(),
): boolean {
  const day = dayKey(now)
  const entry = sendCounts.get(transportId)
  if (!entry || entry.day !== day) return true
  return entry.count < maxPerDay
}

export function recordReachSend(transportId: string, now = new Date()): void {
  const day = dayKey(now)
  const entry = sendCounts.get(transportId)
  if (!entry || entry.day !== day) {
    sendCounts.set(transportId, { day, count: 1 })
    return
  }
  entry.count += 1
}

export function _resetReachRateLimitsForTests(): void {
  sendCounts.clear()
}
