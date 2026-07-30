/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDbHandle, initializeDb } from '../../src/lib/db'
import {
  acquirePiFocus,
  resetPiFocusForTests,
} from '../../src/personal-internet/focus'
import { ensureAndMaterialize } from '../../src/personal-internet/materialize'
import { applyPiMutation } from '../../src/personal-internet/write-path'

describe('pi focus', () => {
  const dirs: string[] = []
  afterEach(() => {
    resetPiFocusForTests()
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-focus-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('switching focus cancels other site materialize runs', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Alpha', stage: 'applied' },
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Beta', stage: 'applied' },
    })

    const a = await ensureAndMaterialize(site.siteId!, 'alpha', {
      materialize: true,
    })
    expect(a.runId).toBeTruthy()

    const b = await ensureAndMaterialize(site.siteId!, 'beta', {
      materialize: true,
    })
    expect(b.runId).toBeTruthy()
    expect(b.runId).not.toBe(a.runId)

    const aRow = getDbHandle()
      .sqlite.prepare(`SELECT status FROM scheduled_runs WHERE id = ?`)
      .get(a.runId!) as { status: string }
    expect(aRow.status).toBe('cancelled')

    const focus = acquirePiFocus({
      siteId: site.siteId!,
      pageId: b.pageId,
      entityKey: 'beta',
      runId: b.runId,
    })
    expect(focus.pageId).toBe(b.pageId)
  })

  it('does not inherit previous page runId when switching without runId', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Alpha', stage: 'applied' },
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Beta', stage: 'applied' },
    })

    const a = await ensureAndMaterialize(site.siteId!, 'alpha', {
      materialize: true,
    })
    expect(a.runId).toBeTruthy()

    const b = await ensureAndMaterialize(site.siteId!, 'beta', {
      materialize: false,
    })
    // ensureAndMaterialize acquires focus then may set runId only when materializing.
    // Re-acquire without runId must not keep alpha's cancelled run id.
    const focus = acquirePiFocus({
      siteId: site.siteId!,
      pageId: b.pageId,
      entityKey: 'beta',
    })
    expect(focus.runId).toBeNull()
    expect(focus.pageId).toBe(b.pageId)
  })
})
