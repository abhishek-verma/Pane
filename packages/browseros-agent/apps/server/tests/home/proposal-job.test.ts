/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProposalJob } from '../../src/home/proposal-job'
import {
  createWidget,
  getWidget,
  getWidgetsDir,
  listWidgets,
} from '../../src/home/widget-store'
import { closeDb, getDbHandle, initializeDb } from '../../src/lib/db'
import {
  claimScheduledRun,
  completeScheduledRun,
  createRunRecord,
} from '../../src/scheduler/run-executor'

describe('proposal-job (M8.3)', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    closeDb()
    for (const d of tempDirs) rmSync(d, { recursive: true, force: true })
    tempDirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'bos-prop-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    return { dir, widgetsDir: getWidgetsDir(dir) }
  }

  it('detects recurring scheduled runs and creates a staged proposal', async () => {
    const { widgetsDir } = setup()

    for (let i = 0; i < 3; i++) {
      const run = createRunRecord({
        source: 'schedule',
        prompt: 'Run weekly competitor scan',
        idempotencyKey: `schedule:weekly-scan:slot${i}`,
        sourceId: 'weekly-scan',
      })
      claimScheduledRun(run.id)
      completeScheduledRun(run.id, {
        status: 'completed',
        result: JSON.stringify({ ok: true }),
      })
    }

    const result = await runProposalJob({ widgetsDir, skipBatteryCheck: true })
    expect(result.staged.length).toBeGreaterThanOrEqual(1)

    const staged = await listWidgets({ status: 'staged' }, widgetsDir)
    expect(staged.length).toBe(1)
    expect(staged[0].createdBy).toBe('agent')
  })

  it('does not re-propose when a widget already exists for scheduled type', async () => {
    const { widgetsDir } = setup()

    for (let i = 0; i < 3; i++) {
      const run = createRunRecord({
        source: 'schedule',
        prompt: 'Daily digest',
        idempotencyKey: `daily:${i}`,
        sourceId: 'daily',
      })
      claimScheduledRun(run.id)
      completeScheduledRun(run.id, {
        status: 'completed',
        result: JSON.stringify({ ok: true }),
      })
    }

    // Create an existing widget for scheduled source
    await createWidget(
      {
        title: 'Daily digest',
        source: { type: 'scheduled' },
        action: { type: 'open-route', target: '#/scheduled' },
        refreshMinutes: 5,
        createdBy: 'user',
        whyText: '',
      },
      widgetsDir,
    )

    const result = await runProposalJob({ widgetsDir, skipBatteryCheck: true })
    expect(result.staged.length).toBe(0)
  })

  it('demotion rule: demotes widgets with showCount > 10 and no action in 14 days', async () => {
    const { widgetsDir } = setup()

    const stale = await createWidget(
      {
        title: 'Stale widget',
        source: { type: 'tasks', query: 'status:pending' },
        action: { type: 'open-route', target: '#/tasks' },
        refreshMinutes: 5,
        createdBy: 'user',
        whyText: '',
      },
      widgetsDir,
    )

    // Simulate showCount > 10 and created 15 days ago with no lastActionAt
    const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000
    getDbHandle()
      .sqlite.prepare(
        'UPDATE home_widgets SET show_count = 11, created_at = ? WHERE id = ?',
      )
      .run(fifteenDaysAgo, stale.id)

    const result = await runProposalJob({ widgetsDir, skipBatteryCheck: true })
    expect(result.demoted).toContain(stale.id)

    const updated = await getWidget(stale.id, widgetsDir)
    expect(updated?.status).toBe('demoted')
  })
})
