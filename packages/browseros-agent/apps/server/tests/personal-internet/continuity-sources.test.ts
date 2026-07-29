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
import {
  continuityFromApprovals,
  mergeContinuityBlocks,
} from '../../src/personal-internet/continuity-sources'
import { buildPiHomeProjection } from '../../src/personal-internet/home-projection'
import { reviseHomeContinuityLocal } from '../../src/personal-internet/refresh/home-revise'
import { writeHomeContinuity } from '../../src/personal-internet/store'
import { applyPiMutation } from '../../src/personal-internet/write-path'
import { createPendingApproval } from '../../src/scheduler/approvals'

describe('pi continuity sources', () => {
  const dirs: string[] = []
  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-cont-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('mergeContinuityBlocks prefers primary then extras without dup ids', () => {
    const merged = mergeContinuityBlocks(
      [{ id: 'a', title: 'A', body: '1' }],
      [
        { id: 'a', title: 'dup', body: 'x' },
        { id: 'b', title: 'B', body: '2' },
      ],
      5,
    )
    expect(merged.map((b) => b.id)).toEqual(['a', 'b'])
  })

  it('surfaces pending approvals in continuity and home revise', async () => {
    setup()
    createPendingApproval({
      runId: 'run1',
      conversationId: null,
      toolCallId: 'tc1',
      toolName: 'navigate',
      consequenceClass: 'write-external',
      preview: 'Open linkedin.com',
    })
    const fromApprovals = continuityFromApprovals()
    expect(fromApprovals.length).toBe(1)
    expect(fromApprovals[0].title).toBe('Approval waiting')
    expect(fromApprovals[0].body).toContain('linkedin')
    expect(fromApprovals[0].route).toBe('#/settings/action-log')
    expect(fromApprovals[0].metadata?.approveToken).toBeTruthy()
    expect(fromApprovals[0].metadata?.denyToken).toBeTruthy()

    await applyPiMutation({ type: 'upsert-site', templateId: 'job-search' })
    const revised = await reviseHomeContinuityLocal()
    expect(revised.blocks.some((b) => b.id.startsWith('approval-'))).toBe(true)

    const projection = await buildPiHomeProjection()
    expect(
      projection.continuity.some((b) => b.id.startsWith('approval-')),
    ).toBe(true)
  })

  it('home revise persists continuity file', async () => {
    setup()
    await writeHomeContinuity([
      { id: 'custom', title: 'Custom', body: 'Keep me' },
    ])
    const revised = await reviseHomeContinuityLocal()
    expect(revised.blocks.some((b) => b.id === 'custom')).toBe(true)
  })
})
