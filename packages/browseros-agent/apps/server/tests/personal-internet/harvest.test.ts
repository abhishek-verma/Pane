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
  enqueueRefresh,
  listPendingJobs,
} from '../../src/personal-internet/refresh/bus'
import { executeRefreshJob } from '../../src/personal-internet/refresh/runner'
import { getPulse, getSite } from '../../src/personal-internet/store'
import { applyPiMutation } from '../../src/personal-internet/write-path'
import { setQuietHoursConfig } from '../../src/reach/quiet-hours'

describe('pi harvest guards', () => {
  const dirs: string[] = []
  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    setQuietHoursConfig({ enabled: false })
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-harvest-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('skips harvest when quiet hours and marks stale', async () => {
    setup()
    setQuietHoursConfig({
      enabled: true,
      startHour: 0,
      endHour: 24,
    })
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
      harvestEnabled: true,
    })
    // Force harvestEnabled in case template path differs
    const row = getSite(site.siteId!)
    expect(row).toBeTruthy()

    enqueueRefresh({
      targetType: 'site',
      targetId: site.siteId!,
      kind: 'C',
      triggerName: 'host-opened',
    })
    const job = listPendingJobs().find((j) => j.kind === 'C')
    expect(job).toBeTruthy()
    const outcome = await executeRefreshJob(job!, { harvestEnabled: true })
    expect(outcome).toBe('skipped-stale')
    const pulse = getPulse(site.siteId!)
    expect(pulse?.staleAt).toBeTruthy()
  })

  it('skips when host tab not in openHosts', async () => {
    setup()
    setQuietHoursConfig({ enabled: false })
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
      harvestEnabled: true,
    })
    enqueueRefresh({
      targetType: 'site',
      targetId: site.siteId!,
      kind: 'C',
      triggerName: 'host-opened',
    })
    const job = listPendingJobs().find((j) => j.kind === 'C')
    const outcome = await executeRefreshJob(job!, {
      harvestEnabled: true,
      openHosts: ['example.com'],
    })
    expect(outcome).toBe('skipped-stale')
  })

  it('enqueues rich pi-harvest run when guards pass', async () => {
    setup()
    setQuietHoursConfig({ enabled: false })
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
      harvestEnabled: true,
    })
    enqueueRefresh({
      targetType: 'site',
      targetId: site.siteId!,
      kind: 'C',
      triggerName: 'host-opened',
    })
    const job = listPendingJobs().find((j) => j.kind === 'C')
    const outcome = await executeRefreshJob(job!, {
      harvestEnabled: true,
      openHosts: ['www.linkedin.com'],
    })
    expect(outcome).toBe('harvested')
    const { getDbHandle } = await import('../../src/lib/db')
    const row = getDbHandle()
      .sqlite.prepare(
        `SELECT prompt, source FROM scheduled_runs WHERE source = 'pi-harvest' ORDER BY created_at DESC LIMIT 1`,
      )
      .get() as { prompt: string; source: string } | null
    expect(row?.source).toBe('pi-harvest')
    expect(row?.prompt).toContain(site.siteId!)
    expect(row?.prompt).toContain('pi_record_upsert')
  })
})
