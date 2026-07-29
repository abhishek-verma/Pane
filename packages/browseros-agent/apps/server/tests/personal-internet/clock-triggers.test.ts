/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initializeDb } from '../../src/lib/db'
import { listPendingJobs } from '../../src/personal-internet/refresh/bus'
import {
  dispatchPreEvent,
  maybeDispatchNewDay,
  readNewDayMarker,
} from '../../src/personal-internet/refresh/clock'

describe('pi clock triggers', () => {
  const dirs: string[] = []
  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-clock-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    return dir
  }

  it('dispatches new-day once per local day', () => {
    const dir = setup()
    const now = new Date('2026-07-29T10:00:00')
    expect(maybeDispatchNewDay(now, dir)).toBe(true)
    expect(readNewDayMarker(dir)).toBe('2026-07-29')
    const before = listPendingJobs().length
    expect(maybeDispatchNewDay(now, dir)).toBe(false)
    expect(listPendingJobs().length).toBe(before)
    expect(maybeDispatchNewDay(new Date('2026-07-30T01:00:00'), dir)).toBe(true)
  })

  it('dispatchPreEvent enqueues home jobs', () => {
    setup()
    const before = listPendingJobs().length
    const n = dispatchPreEvent({
      meetingTitle: 'Interview with Acme',
      startsAtIso: new Date().toISOString(),
      sessionId: 'sess_test',
    })
    expect(n).toBeGreaterThan(0)
    expect(listPendingJobs().length).toBeGreaterThan(before)
  })
})
