/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Clock triggers: new-day, return-from-sleep, thin pre-event from Pane meetings.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getBrowserosDir } from '../../lib/browseros-dir'
import { getDbHandle } from '../../lib/db'
import { logger } from '../../lib/logger'
import { dispatchTrigger } from './bus'

function markerPath(browserosDir?: string): string {
  return join(
    browserosDir ?? getBrowserosDir(),
    'personal-internet',
    'home',
    'new-day-marker',
  )
}

function preEventMarkerPath(browserosDir?: string): string {
  return join(
    browserosDir ?? getBrowserosDir(),
    'personal-internet',
    'home',
    'pre-event-fired.json',
  )
}

function localDayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function readNewDayMarker(browserosDir?: string): string | null {
  try {
    return readFileSync(markerPath(browserosDir), 'utf-8').trim() || null
  } catch {
    return null
  }
}

export function writeNewDayMarker(day: string, browserosDir?: string): void {
  const path = markerPath(browserosDir)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, day, 'utf-8')
}

/** Dispatch `new-day` at most once per local calendar day. Returns true if fired. */
export function maybeDispatchNewDay(
  now: Date = new Date(),
  browserosDir?: string,
): boolean {
  const key = localDayKey(now)
  const prev = readNewDayMarker(browserosDir)
  if (prev === key) return false
  writeNewDayMarker(key, browserosDir)
  const jobs = dispatchTrigger({ triggerName: 'new-day' })
  logger.info('pi new-day dispatched', { day: key, jobs: jobs.length })
  return true
}

let lastActivityAt = Date.now()
let sleepDispatchedForGap = false
const SLEEP_GAP_MS = 30 * 60 * 1000

/** Call from PI tick / catch-up. If wall clock jumped ≥30m, fire return-from-sleep once. */
export function maybeDispatchReturnFromSleep(
  nowMs: number = Date.now(),
): boolean {
  const gap = nowMs - lastActivityAt
  lastActivityAt = nowMs
  if (gap < SLEEP_GAP_MS) {
    sleepDispatchedForGap = false
    return false
  }
  if (sleepDispatchedForGap) return false
  sleepDispatchedForGap = true
  const jobs = dispatchTrigger({ triggerName: 'return-from-sleep' })
  logger.info('pi return-from-sleep dispatched', {
    gapMs: gap,
    jobs: jobs.length,
  })
  return true
}

/** Thin pre-event: only if caller passes a known meeting title/start. */
export function dispatchPreEvent(input: {
  meetingTitle: string
  startsAtIso: string
  sessionId?: string
}): number {
  const jobs = dispatchTrigger({
    triggerName: 'pre-event',
    filterValue: input.meetingTitle,
  })
  if (input.sessionId) {
    markPreEventFired(input.sessionId)
  }
  return jobs.length
}

function readPreEventFired(browserosDir?: string): Record<string, number> {
  try {
    return JSON.parse(
      readFileSync(preEventMarkerPath(browserosDir), 'utf-8'),
    ) as Record<string, number>
  } catch {
    return {}
  }
}

function markPreEventFired(sessionId: string, browserosDir?: string): void {
  const path = preEventMarkerPath(browserosDir)
  mkdirSync(dirname(path), { recursive: true })
  const map = readPreEventFired(browserosDir)
  map[sessionId] = Date.now()
  // Drop entries older than 24h
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const [k, v] of Object.entries(map)) {
    if (v < cutoff) delete map[k]
  }
  writeFileSync(path, JSON.stringify(map), 'utf-8')
}

/**
 * Thin path: active Pane capture meetings (no Calendar OAuth).
 * Fires once per session while status=active.
 */
export function maybeDispatchPreEventFromActiveMeetings(
  browserosDir?: string,
): number {
  let fired = 0
  try {
    const rows = getDbHandle()
      .sqlite.prepare(
        `SELECT id, title, started_at FROM capture_sessions
         WHERE kind = 'meeting' AND status = 'active'`,
      )
      .all() as Array<{ id: string; title: string | null; started_at: number }>
    const already = readPreEventFired(browserosDir)
    for (const row of rows) {
      if (already[row.id]) continue
      const title = (row.title ?? 'Meeting').trim() || 'Meeting'
      fired += dispatchPreEvent({
        meetingTitle: title,
        startsAtIso: new Date(row.started_at).toISOString(),
        sessionId: row.id,
      })
    }
  } catch (err) {
    logger.debug('pi pre-event scan skipped', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return fired
}
