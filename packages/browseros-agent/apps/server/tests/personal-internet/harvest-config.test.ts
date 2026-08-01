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
  buildHarvestPolicy,
  formatHarvestPrompt,
  harvestConfigFromSite,
  proposeHarvestConfig,
} from '../../src/personal-internet/harvest-config'
import {
  clearRefreshCoalesceState,
  dispatchTrigger,
  handleHostOpened,
  resetRefreshBusWiringForTests,
} from '../../src/personal-internet/refresh/bus'
import { executeRefreshJob } from '../../src/personal-internet/refresh/runner'
import {
  getPolicy,
  getSite,
  upsertSite,
} from '../../src/personal-internet/store'
import { getSiteTemplate } from '../../src/personal-internet/templates'
import { applyPiMutation } from '../../src/personal-internet/write-path'
import { setQuietHoursConfig } from '../../src/reach/quiet-hours'

describe('pi harvest config', () => {
  const dirs: string[] = []
  afterEach(() => {
    resetRefreshBusWiringForTests()
    clearRefreshCoalesceState()
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
    setQuietHoursConfig({ enabled: false })
    return dir
  }

  it('templates have no default harvest host or host-opened trigger', () => {
    for (const id of ['job-search', 'research-hub', 'sales-leads'] as const) {
      const t = getSiteTemplate(id)
      expect(t.harvestHost).toBeNull()
      expect(t.policy.triggers.some((tr) => tr.name === 'host-opened')).toBe(
        false,
      )
    }
  })

  it('create returns harvestOffer and leaves harvest off', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    expect(created.created).toBe(true)
    expect(created.harvestOffer?.requiresUserConfirmation).toBe(true)
    expect(created.harvestOffer?.proposedConfig.harvestEnabled).toBe(true)
    expect(created.harvestOffer?.proposedConfig.harvestSources).toEqual([])
    const site = getSite(created.siteId!)!
    expect(site.harvestEnabled).toBe(0)
    expect(JSON.parse(site.harvestSourcesJson)).toEqual([])
    const policy = getPolicy('site', site.id)!
    expect(policy.triggers.some((t) => t.kind === 'C')).toBe(false)
  })

  it('upsert harvest knobs rebuilds policy triggers', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'sales-leads',
    })
    await applyPiMutation({
      type: 'upsert-site',
      slug: 'sales-leads',
      harvestEnabled: true,
      harvestSources: ['linkedin.com', 'mail.google.com'],
      harvestCadenceDays: 3,
      harvestInstructions: 'Only open opportunities',
      harvestFromMeetings: true,
      harvestOnHostOpened: true,
      harvestAllowNavigate: true,
    })
    const site = getSite(created.siteId!)!
    const config = harvestConfigFromSite(site)
    expect(config.enabled).toBe(true)
    expect(config.sources).toEqual(['linkedin.com', 'mail.google.com'])
    expect(config.cadenceDays).toBe(3)
    expect(config.instructions).toBe('Only open opportunities')
    expect(config.fromMeetings).toBe(true)
    expect(config.onHostOpened).toBe(true)
    expect(config.allowNavigate).toBe(true)
    expect(site.harvestHost).toBe('linkedin.com')

    const policy = getPolicy('site', site.id)!
    expect(
      policy.triggers.filter((t) => t.name === 'host-opened'),
    ).toHaveLength(2)
    expect(policy.triggers.some((t) => t.name === 'harvest-due')).toBe(true)
    expect(policy.triggers.some((t) => t.name === 'meeting-ended')).toBe(true)
  })

  it('host-opened enqueues only when onHostOpened + sources match', async () => {
    setup()
    await upsertSite({
      name: 'Pipeline',
      slug: 'pipe',
      harvestEnabled: true,
      harvestSources: ['linkedin.com'],
      harvestOnHostOpened: true,
    })
    expect(handleHostOpened('linkedin.com').length).toBeGreaterThan(0)
    clearRefreshCoalesceState()
    expect(handleHostOpened('example.com')).toHaveLength(0)
  })

  it('harvest-due without open tabs enqueues when allowNavigate', async () => {
    setup()
    const site = await upsertSite({
      name: 'News',
      slug: 'news',
      jtbd: 'Track industry news',
      harvestEnabled: true,
      harvestSources: ['news.ycombinator.com'],
      harvestAllowNavigate: true,
      harvestOnHostOpened: false,
    })
    // Rebuild policy as write-path would
    const { upsertPolicy } = await import('../../src/personal-internet/store')
    upsertPolicy(
      'site',
      site.id,
      buildHarvestPolicy(harvestConfigFromSite(site)),
    )

    const jobs = dispatchTrigger({
      triggerName: 'harvest-due',
      skipHome: true,
    })
    expect(jobs.some((j) => j.targetId === site.id && j.kind === 'C')).toBe(
      true,
    )
    const job = jobs.find((j) => j.targetId === site.id)!
    const outcome = await executeRefreshJob(job, { openHosts: [] })
    expect(outcome).toBe('harvested')

    const runs = getDbHandle()
      .sqlite.prepare(
        `SELECT idempotency_key, prompt FROM scheduled_runs WHERE source_id = ?`,
      )
      .all(site.id) as Array<{ idempotency_key: string; prompt: string }>
    expect(runs).toHaveLength(1)
    expect(runs[0]!.prompt).toContain('trigger=harvest-due')
    expect(runs[0]!.prompt).toContain('mayOpenOrNavigateSources=yes')
    expect(runs[0]!.prompt).toContain('news.ycombinator.com')
    expect(runs[0]!.prompt).toContain('do not assume job-application')
    expect(runs[0]!.prompt).toContain('Optional domain skill: none')
  })

  it('cadence skips second browser harvest in the same window', async () => {
    setup()
    const site = await upsertSite({
      name: 'Research',
      slug: 'research',
      harvestEnabled: true,
      harvestSources: ['example.com'],
      harvestAllowNavigate: true,
      harvestCadenceDays: 1,
    })
    const { upsertPolicy } = await import('../../src/personal-internet/store')
    upsertPolicy(
      'site',
      site.id,
      buildHarvestPolicy(harvestConfigFromSite(site)),
    )

    const firstJobs = dispatchTrigger({
      triggerName: 'harvest-due',
      skipHome: true,
    })
    const first = firstJobs.find((j) => j.targetId === site.id)!
    expect(await executeRefreshJob(first, { openHosts: [] })).toBe('harvested')

    const secondJobs = dispatchTrigger({
      triggerName: 'harvest-due',
      skipHome: true,
    })
    const second = secondJobs.find((j) => j.targetId === site.id)
    // Coalesced into browser key while first may still be pending as refresh job done —
    // a new job may be created; runner should skip on cadence.
    if (second && second.status === 'pending') {
      expect(await executeRefreshJob(second, { openHosts: [] })).toBe(
        'skipped-stale',
      )
    }
    const count = (
      getDbHandle()
        .sqlite.prepare(
          `SELECT count(*) as c FROM scheduled_runs WHERE source_id = ?`,
        )
        .get(site.id) as { c: number }
    ).c
    expect(count).toBe(1)
  })

  it('meeting-ended enqueues per-session without consuming browser cadence', async () => {
    setup()
    const site = await upsertSite({
      name: 'Sales',
      slug: 'sales',
      harvestEnabled: true,
      harvestSources: ['linkedin.com'],
      harvestFromMeetings: true,
      harvestAllowNavigate: true,
    })
    const { upsertPolicy } = await import('../../src/personal-internet/store')
    upsertPolicy(
      'site',
      site.id,
      buildHarvestPolicy(harvestConfigFromSite(site)),
    )

    const jobs = dispatchTrigger({
      triggerName: 'meeting-ended',
      filterValue: 'sess_abc',
      skipHome: true,
    })
    const job = jobs.find((j) => j.targetId === site.id)!
    expect(job.coalesceKey).toContain('meeting:sess_abc')
    expect(await executeRefreshJob(job, { openHosts: [] })).toBe('harvested')

    const run = getDbHandle()
      .sqlite.prepare(
        `SELECT idempotency_key, prompt FROM scheduled_runs WHERE source_id = ?`,
      )
      .get(site.id) as { idempotency_key: string; prompt: string }
    expect(run.idempotency_key).toBe(`pi-harvest:${site.id}:meeting:sess_abc`)
    expect(run.prompt).toContain('trigger=meeting-ended')
    expect(run.prompt).toContain('sessionId=sess_abc')

    // Idempotent re-dispatch
    const again = dispatchTrigger({
      triggerName: 'meeting-ended',
      filterValue: 'sess_abc',
      skipHome: true,
    })
    const againJob = again.find((j) => j.targetId === site.id)
    if (againJob?.status === 'pending') {
      expect(await executeRefreshJob(againJob, { openHosts: [] })).toBe(
        'skipped-stale',
      )
    }
    const count = (
      getDbHandle()
        .sqlite.prepare(
          `SELECT count(*) as c FROM scheduled_runs WHERE source_id = ?`,
        )
        .get(site.id) as { c: number }
    ).c
    expect(count).toBe(1)
  })

  it('prompt contract includes JTBD, config flags, and custom instructions', async () => {
    setup()
    const site = await upsertSite({
      name: 'Outreach',
      slug: 'outreach',
      jtbd: 'Track outbound sequences',
      harvestEnabled: true,
      harvestSources: ['gmail.com'],
      harvestInstructions: 'Ignore newsletters',
      harvestAllowNavigate: true,
      harvestOnHostOpened: true,
      harvestFromMeetings: false,
    })
    const prompt = formatHarvestPrompt({
      site,
      config: harvestConfigFromSite(site),
      triggerName: 'harvest-due',
      connectedMcps: [],
      records: [],
    })
    expect(prompt).toContain(`siteId=${site.id}`)
    expect(prompt).toContain('Track outbound sequences')
    expect(prompt).toContain('allowNavigate=true')
    expect(prompt).toContain('Ignore newsletters')
    expect(prompt).toContain('none yet')
    expect(prompt).not.toContain('recordType job-application')
  })

  it('proposeHarvestConfig suggests meetings for interview JTBD', () => {
    const offer = proposeHarvestConfig({
      templateId: 'job-search',
      jtbd: 'Maintain applications and interviews',
    })
    expect(offer.proposedConfig.harvestFromMeetings).toBe(true)
    expect(offer.proposedConfig.harvestSources).toEqual([])
  })

  it('harvest-due with allowNavigate off skips when source tab closed', async () => {
    setup()
    const site = await upsertSite({
      name: 'CRM',
      slug: 'crm',
      harvestEnabled: true,
      harvestSources: ['salesforce.com'],
      harvestAllowNavigate: false,
      harvestOnHostOpened: false,
    })
    const { upsertPolicy } = await import('../../src/personal-internet/store')
    upsertPolicy(
      'site',
      site.id,
      buildHarvestPolicy(harvestConfigFromSite(site)),
    )
    expect(
      getPolicy('site', site.id)!.triggers.some(
        (t) => t.name === 'harvest-due',
      ),
    ).toBe(true)

    const jobs = dispatchTrigger({
      triggerName: 'harvest-due',
      skipHome: true,
    })
    const job = jobs.find((j) => j.targetId === site.id)!
    expect(await executeRefreshJob(job, { openHosts: [] })).toBe(
      'skipped-stale',
    )
    const count = (
      getDbHandle()
        .sqlite.prepare(
          `SELECT count(*) as c FROM scheduled_runs WHERE source_id = ?`,
        )
        .get(site.id) as { c: number }
    ).c
    expect(count).toBe(0)
  })
})
