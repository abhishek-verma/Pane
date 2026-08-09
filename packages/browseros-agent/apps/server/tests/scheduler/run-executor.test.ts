/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  spyOn,
} from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { conversationTurnRegistry } from '../../src/agent/conversation-turn-registry'
import { closeDb, getDb, initializeDb } from '../../src/lib/db'
import { scheduledRuns } from '../../src/lib/db/schema/scheduled-runs'
import { reclaimStaleRunningRuns } from '../../src/scheduler/run-executor'

describe('reclaimStaleRunningRuns', () => {
  const tempDirs: string[] = []
  let cancelActiveFor: Mock<typeof conversationTurnRegistry.cancelActiveFor>

  beforeEach(() => {
    // spyOn the real singleton instead of mock.module — mock.module mutates
    // a process-wide registry that isn't reset between test files, and a
    // partial replacement here (an object with only cancelActiveFor) leaked
    // into other suites that import the real conversationTurnRegistry for
    // its other methods (getActiveFor, cancel, ...), breaking them.
    cancelActiveFor = spyOn(
      conversationTurnRegistry,
      'cancelActiveFor',
    ).mockReturnValue(false)
    const dir = mkdtempSync(join(tmpdir(), 'browseros-run-executor-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  })

  afterEach(() => {
    cancelActiveFor.mockRestore()
    closeDb()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it('cancels the underlying chat turn for each reclaimed run', () => {
    const now = Date.now()
    getDb()
      .insert(scheduledRuns)
      .values({
        id: 'run_1',
        source: 'pi-materialize',
        sourceId: 'page_1',
        idempotencyKey: 'key_1',
        prompt: 'refresh page_1',
        status: 'running',
        completedStepsJson: '[]',
        conversationId: 'conv_orphaned',
        startedAt: now - 20 * 60_000,
        createdAt: now - 20 * 60_000,
      })
      .run()

    const reclaimed = reclaimStaleRunningRuns()

    expect(reclaimed).toBe(1)
    expect(cancelActiveFor).toHaveBeenCalledWith(
      'conv_orphaned',
      'scheduled-run-reclaimed',
    )
  })

  it('does not call cancel for a run with no conversationId yet', () => {
    const now = Date.now()
    getDb()
      .insert(scheduledRuns)
      .values({
        id: 'run_2',
        source: 'pi-harvest',
        sourceId: null,
        idempotencyKey: 'key_2',
        prompt: 'harvest',
        status: 'running',
        completedStepsJson: '[]',
        conversationId: null,
        startedAt: now - 20 * 60_000,
        createdAt: now - 20 * 60_000,
      })
      .run()

    reclaimStaleRunningRuns()

    expect(cancelActiveFor).not.toHaveBeenCalled()
  })
})
