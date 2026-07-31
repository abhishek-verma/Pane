/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Sweeper — periodic housekeeping for the refresh bus:
 *   - Expire temp pages past their TTL (kept-pending temps survive).
 *   - Replay missed clock triggers once on browser start (`browser-started`
 *     catch-up), so overnight `new-day` work runs without replaying every
 *     historical host-open.
 */

import { getDbHandle } from '../../lib/db'
import { dispatchTrigger, enqueueRefresh, type PiRefreshJob } from './bus'
import {
  maybeDispatchNewDay,
  maybeDispatchPreEventFromActiveMeetings,
  maybeDispatchReturnFromSleep,
} from './clock'
import { HOME_TARGET_ID } from './policy'
import { type RefreshRunResult, runRefreshJobs } from './runner'

/** Interval between periodic ticks (temp expiry + cheap reproject drain). */
export const PI_REFRESH_INTERVAL_MS = 15 * 60 * 1000

function sqlite() {
  return getDbHandle().sqlite
}

/** Marks active temps whose TTL has passed as `expired`. Returns their ids. */
export function expireTemps(nowMs: number = Date.now()): string[] {
  const rows = sqlite()
    .prepare(
      `SELECT id FROM pi_temps WHERE status = 'active' AND expires_at < ?`,
    )
    .all(nowMs) as Array<{ id: string }>
  for (const row of rows) {
    sqlite()
      .prepare(
        `UPDATE pi_temps SET status = 'expired', updated_at = ? WHERE id = ?`,
      )
      .run(nowMs, row.id)
  }
  return rows.map((r) => r.id)
}

/**
 * Browser-started catch-up rebuilds the one surface that is immediately
 * relevant: Home. Individual PI sites are refreshed on visit or by their own
 * configured trigger. This deliberately avoids turning a week away from Pane
 * into a burst of background work for every historical site.
 */
export function browserStartedCatchUp(): { enqueued: number } {
  enqueueRefresh({
    targetType: 'home',
    targetId: HOME_TARGET_ID,
    kind: 'A',
    triggerName: 'browser-started',
  })
  return { enqueued: 1 }
}

/** Test / API helper — expire temps and return count. */
export async function sweepExpiredTemps(
  nowMs: number = Date.now(),
): Promise<number> {
  return expireTemps(nowMs).length
}

export type SweepResult = {
  expired: string[]
  refreshed: RefreshRunResult
}

/** Interval tick: expire temps, clock triggers, then drain pending jobs. */
export async function runPersonalInternetTick(
  options: { now?: number } = {},
): Promise<SweepResult> {
  const nowMs = options.now ?? Date.now()
  const expired = expireTemps(nowMs)
  maybeDispatchReturnFromSleep(nowMs)
  maybeDispatchNewDay(new Date(nowMs))
  maybeDispatchPreEventFromActiveMeetings()
  const refreshed = await runRefreshJobs()
  return { expired, refreshed }
}

/** One-shot catch-up + drain, called once when the browser/server starts. */
export async function runBrowserStartedCatchUp(): Promise<SweepResult> {
  const expired = expireTemps()
  maybeDispatchNewDay()
  maybeDispatchReturnFromSleep()
  browserStartedCatchUp()
  const refreshed = await runRefreshJobs()
  return { expired, refreshed }
}

/** Convenience re-export so callers can trigger a manual refresh + drain. */
export async function manualRefresh(siteId?: string): Promise<{
  jobIds: string[]
  refreshed: RefreshRunResult
}> {
  const jobs = dispatchTrigger({ triggerName: 'manual-refresh', siteId })
  const refreshed = await runRefreshJobs()
  return { jobIds: jobs.map((j) => j.id), refreshed }
}

export type { PiRefreshJob }
