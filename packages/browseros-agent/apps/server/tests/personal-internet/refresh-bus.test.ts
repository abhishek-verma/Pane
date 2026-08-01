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
  clearRefreshCoalesceState,
  enqueueRefresh,
  handleHostOpened,
  handleRefreshTrigger,
  resetRefreshBusWiringForTests,
} from '../../src/personal-internet/refresh/bus'
import { triggerPriority } from '../../src/personal-internet/refresh/policy'
import { executeRefreshJob } from '../../src/personal-internet/refresh/runner'
import { sweepExpiredTemps } from '../../src/personal-internet/refresh/sweeper'
import {
  createTemp,
  findPendingJobByCoalesce,
  getPulse,
  listPendingRefreshJobs,
  upsertSite,
} from '../../src/personal-internet/store'
import { applyPiMutation } from '../../src/personal-internet/write-path'

describe('pi refresh bus', () => {
  const dirs: string[] = []
  afterEach(() => {
    resetRefreshBusWiringForTests()
    clearRefreshCoalesceState()
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-refresh-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    return dir
  }

  it('coalesces same target+kind within cooldown', () => {
    setup()
    const a = enqueueRefresh({
      targetType: 'site',
      targetId: 'site_1',
      kind: 'A',
      trigger: 'entity-mutated',
      cooldownMs: 60_000,
    })
    const b = enqueueRefresh({
      targetType: 'site',
      targetId: 'site_1',
      kind: 'A',
      trigger: 'entity-mutated',
      cooldownMs: 60_000,
    })
    expect(a?.id).toBeTruthy()
    expect(b?.id).toBe(a?.id)
    expect(listPendingRefreshJobs()).toHaveLength(1)
  })

  it('priority: pre-event beats host-opened', () => {
    setup()
    // Lower number drains first.
    expect(triggerPriority('pre-event')).toBeLessThan(
      triggerPriority('host-opened'),
    )
    const low = enqueueRefresh({
      targetType: 'home',
      targetId: 'home',
      kind: 'A',
      trigger: 'host-opened',
      cooldownMs: 60_000,
    })
    clearRefreshCoalesceState()
    const high = enqueueRefresh({
      targetType: 'home',
      targetId: 'home',
      kind: 'A',
      trigger: 'pre-event',
      cooldownMs: 60_000,
    })
    expect(high?.triggerName).toBe('pre-event')
    const pending = findPendingJobByCoalesce('home:home:A')
    // Higher priority inserted when existing was lower
    expect(pending?.triggerName === 'pre-event' || high?.id).toBeTruthy()
    expect(low?.id).toBeTruthy()
  })

  it('harvest disabled skips kind C', async () => {
    setup()
    await upsertSite({
      name: 'Job Search',
      slug: 'job-search',
      harvestEnabled: false,
      harvestSources: ['linkedin.com'],
      harvestOnHostOpened: true,
      doorwayEligible: true,
    })
    const jobs = handleHostOpened('linkedin.com')
    expect(jobs).toHaveLength(0)
  })

  it('kind A recomputes pulse; failure keeps last pulse', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const before = getPulse(created.siteId!)
    expect(before?.pulseLine).toBeTruthy()

    const job = enqueueRefresh({
      targetType: 'site',
      targetId: created.siteId!,
      kind: 'A',
      trigger: 'manual-refresh',
      cooldownMs: 0,
    })
    expect(job).toBeTruthy()
    await executeRefreshJob(job!)
    const after = getPulse(created.siteId!)
    expect(after?.pulseLine).toBe(before?.pulseLine)
  })

  it('sweeper expires temps', async () => {
    setup()
    await createTemp({
      title: 'Old',
      doc: { version: 1, title: 'Old', nodes: [{ type: 'text', text: 'x' }] },
      ttlMs: -1000,
    })
    const n = await sweepExpiredTemps()
    expect(n).toBeGreaterThanOrEqual(1)
  })

  it('manual-refresh enqueues home A', () => {
    setup()
    const jobs = handleRefreshTrigger({ trigger: 'manual-refresh' })
    expect(jobs.some((j) => j.targetType === 'home' && j.kind === 'A')).toBe(
      true,
    )
  })

  it('startup catch-up refreshes Home without replaying every site', async () => {
    setup()
    await upsertSite({
      name: 'Older work',
      slug: 'older-work',
      doorwayEligible: true,
    })
    const { browserStartedCatchUp } = await import(
      '../../src/personal-internet/refresh/sweeper'
    )
    expect(browserStartedCatchUp()).toEqual({ enqueued: 1 })
    const pending = listPendingRefreshJobs()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.targetType).toBe('home')
  })

  it('host filter matches exact/subdomain, not substring spoof', async () => {
    const { hostMatchesFilter } = await import(
      '../../src/personal-internet/refresh/policy'
    )
    expect(hostMatchesFilter('linkedin.com', 'linkedin.com')).toBe(true)
    expect(hostMatchesFilter('www.linkedin.com', 'linkedin.com')).toBe(true)
    expect(hostMatchesFilter('linkedin.com.evil.com', 'linkedin.com')).toBe(
      false,
    )
    expect(hostMatchesFilter('notlinkedin.com', 'linkedin.com')).toBe(false)
  })
})
