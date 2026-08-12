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
import { buildPiHomeProjection } from '../../src/personal-internet/home-projection'
import { buildPersonalInternetToolSet } from '../../src/personal-internet/tools'
import { applyPiMutation } from '../../src/personal-internet/write-path'
import { loadHome } from '../../src/scheduler/home'

describe('pi home bridge', () => {
  const dirs: string[] = []
  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-home-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    return dir
  }

  it('empty profile returns empty doorways', async () => {
    setup()
    const pi = await buildPiHomeProjection()
    expect(pi.doorways).toEqual([])
    expect(pi.libraryCount).toBe(0)
    expect(pi.generatedAt).toBeTruthy()
  })

  it('libraryCount excludes archived sites', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const siteId = created.siteId!
    const before = await buildPiHomeProjection()
    expect(before.libraryCount).toBe(1)

    await applyPiMutation({ type: 'archive-site', siteId })
    const after = await buildPiHomeProjection()
    expect(after.libraryCount).toBe(0)
  })

  it('doorway appears after P0 site create; home payload includes pi', async () => {
    setup()
    await applyPiMutation({ type: 'upsert-site', templateId: 'job-search' })
    const pi = await buildPiHomeProjection()
    expect(pi.doorways.length).toBeGreaterThanOrEqual(1)
    expect(pi.doorways[0]?.name).toBe('Job Search')
    expect(pi.doorways[0]?.primaryRoute).toContain('#/pi/sites/')
    expect(pi.libraryCount).toBe(1)

    const home = await loadHome()
    expect(home.pi).toBeTruthy()
    expect(home.pi.doorways.length).toBeGreaterThanOrEqual(1)
    expect(home.firstName === null || typeof home.firstName === 'string').toBe(
      true,
    )
  })

  it('hide removes doorway and legacy continuity never becomes Home truth', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const siteId = created.siteId!
    const tools = buildPersonalInternetToolSet()
    const hide = await tools.pi_home_regions_patch.execute?.(
      {
        hideSiteId: siteId,
        continuity: [
          {
            id: 'today-1',
            title: 'Follow up',
            body: 'Email Acme recruiter',
            route: `#/pi/sites/${siteId}`,
          },
        ],
      },
      { toolCallId: 't', messages: [] },
    )
    expect((hide as { isError?: boolean }).isError).toBeFalsy()

    const pi = await buildPiHomeProjection()
    expect(pi.doorways.find((d) => d.siteId === siteId)).toBeUndefined()
    expect(pi.continuity.some((c) => c.id === 'today-1')).toBe(false)
    expect(pi.libraryCount).toBe(1)
  })

  it('refresh keeps a user dismissal and ignores stale persisted cards', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const siteId = created.siteId!
    const { writeHomeContinuity, dismissContinuityBlock, readHomePrefs } =
      await import('../../src/personal-internet/store')
    const { refreshHomeToday } = await import(
      '../../src/personal-internet/refresh/home-revise'
    )

    await writeHomeContinuity([
      {
        id: 'today-stale',
        title: 'Old follow-up',
        body: 'No longer relevant',
        route: `#/pi/sites/${siteId}`,
      },
      {
        id: 'today-keep',
        title: 'Still open',
        body: 'Call back tomorrow',
        route: `#/pi/sites/${siteId}`,
      },
    ])

    await dismissContinuityBlock('today-stale')
    const afterDismiss = await buildPiHomeProjection()
    expect(afterDismiss.continuity.some((c) => c.id === 'today-stale')).toBe(
      false,
    )
    expect(afterDismiss.continuity.some((c) => c.id === 'today-keep')).toBe(
      false,
    )
    expect((await readHomePrefs()).dismissedContinuityIds).toContain(
      'today-stale',
    )

    await refreshHomeToday()
    const afterRefresh = await buildPiHomeProjection()
    expect((await readHomePrefs()).dismissedContinuityIds).toContain(
      'today-stale',
    )
    // Refresh rebuilds from current canonical inputs only.
    expect(afterRefresh.continuity.some((c) => c.id === 'today-stale')).toBe(
      false,
    )
  })

  it('dismissing a proposed doorway removes it and survives a rebuild', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'reading-list',
    })
    const siteId = created.siteId!

    const before = await buildPiHomeProjection()
    expect(before.proposeDoorways?.some((p) => p.siteId === siteId)).toBe(true)

    const { dismissProposedDoorway, readHomePrefs } = await import(
      '../../src/personal-internet/store'
    )
    await dismissProposedDoorway(siteId)

    const after = await buildPiHomeProjection()
    expect((after.proposeDoorways ?? []).some((p) => p.siteId === siteId)).toBe(
      false,
    )
    expect((await readHomePrefs()).dismissedProposeIds).toContain(siteId)
  })

  it('POST /pi/home/propose/dismiss removes the site from future propose lists', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'reading-list',
    })
    const siteId = created.siteId!
    const { Hono } = await import('hono')
    const { createPersonalInternetRoutes } = await import(
      '../../src/api/routes/personal-internet'
    )
    const app = new Hono().route('/pi', createPersonalInternetRoutes())
    const res = await app.request('/pi/home/propose/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId }),
    })
    expect(res.status).toBe(200)
    const pi = await buildPiHomeProjection()
    expect((pi.proposeDoorways ?? []).some((p) => p.siteId === siteId)).toBe(
      false,
    )
  })

  it('surfaces up to 2 urgencies per site in Today, across all doorways', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const siteId = created.siteId!
    // Three job-application records, each with its own nextAction — the
    // template requires `company` and stores stage on `data.stage`, so give
    // each a distinct company and stage.
    await applyPiMutation({
      type: 'upsert-record',
      siteId,
      recordType: 'job-application',
      data: {
        company: 'Acme',
        stage: 'applied',
        nextAction: 'Follow up with Acme recruiter',
      },
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId,
      recordType: 'job-application',
      data: {
        company: 'Beta',
        stage: 'interviewing',
        nextAction: 'Prep for Beta onsite',
      },
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId,
      recordType: 'job-application',
      data: {
        company: 'Gamma',
        stage: 'applied',
        nextAction: 'Send Gamma portfolio',
      },
    })

    const pi = await buildPiHomeProjection()
    const siteUrgencies = pi.continuity.filter((c) => c.title === 'Job Search')
    expect(siteUrgencies.length).toBe(2)
  })

  it('a dismissed urgency stays dismissed after an unrelated record edit reorders topUrgencies', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const siteId = created.siteId!
    const recA = await applyPiMutation({
      type: 'upsert-record',
      siteId,
      recordType: 'job-application',
      data: { company: 'Acme', stage: 'applied', nextAction: 'Follow up A' },
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId,
      recordType: 'job-application',
      data: { company: 'Beta', stage: 'applied', nextAction: 'Follow up B' },
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId,
      recordType: 'job-application',
      data: { company: 'Gamma', stage: 'applied', nextAction: 'Follow up C' },
    })

    // C is most recently updated, so it's in the initial top-2 — dismiss it.
    const before = await buildPiHomeProjection()
    const cBlock = before.continuity.find((c) => c.body === 'Follow up C')
    expect(cBlock).toBeTruthy()
    const { dismissContinuityBlock } = await import(
      '../../src/personal-internet/store'
    )
    await dismissContinuityBlock(cBlock?.id)

    // Editing A (unrelated to the dismissal) bumps its updated_at, pushing it
    // ahead of C in topUrgencies — with position-keyed ids this would have
    // un-dismissed C and incorrectly suppressed A instead.
    await applyPiMutation({
      type: 'upsert-record',
      siteId,
      recordId: recA.recordId,
      recordType: 'job-application',
      data: { company: 'Acme', stage: 'applied', nextAction: 'Follow up A' },
    })

    const after = await buildPiHomeProjection()
    const bodies = after.continuity.map((c) => c.body)
    expect(bodies).toContain('Follow up A')
    expect(bodies).not.toContain('Follow up C')
  })

  it('doorwayCount reports the true total even when doorways is capped at 8', async () => {
    setup()
    const { updateDoorwayVisibility } = await import(
      '../../src/personal-internet/store'
    )
    for (let i = 0; i < 9; i++) {
      const created = await applyPiMutation({
        type: 'upsert-site',
        templateId: 'reading-list',
        // upsert-site collapses onto the same site by slug when omitted
        // (templates default to a singleton slug) — give each its own.
        slug: `reading-list-${i}`,
        name: `Reading List ${i}`,
      })
      // Pin so each site becomes a doorway regardless of P0 auto-eligibility.
      await updateDoorwayVisibility({ pinSiteId: created.siteId! })
    }

    const pi = await buildPiHomeProjection()
    expect(pi.doorways.length).toBe(8)
    expect(pi.doorwayCount).toBe(9)
  })

  it('doorway payload includes the site template id', async () => {
    setup()
    await applyPiMutation({ type: 'upsert-site', templateId: 'job-search' })
    const pi = await buildPiHomeProjection()
    expect(pi.doorways[0]?.templateId).toBe('job-search')
  })

  it('updateDoorwayVisibility hides a doorway and unhide restores it', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const siteId = created.siteId!
    await applyPiMutation({
      type: 'upsert-record',
      siteId,
      recordType: 'job-application',
      data: { company: 'Acme', stage: 'applied' },
    })
    const { updateDoorwayVisibility } = await import(
      '../../src/personal-internet/store'
    )

    await updateDoorwayVisibility({ hideSiteId: siteId })
    const hidden = await buildPiHomeProjection()
    expect(hidden.doorways.find((d) => d.siteId === siteId)).toBeUndefined()

    await updateDoorwayVisibility({ unhideSiteId: siteId })
    const restored = await buildPiHomeProjection()
    expect(restored.doorways.find((d) => d.siteId === siteId)).toBeTruthy()
  })

  it('doorway payload marks pinned sites', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const siteId = created.siteId!
    const { updateDoorwayVisibility } = await import(
      '../../src/personal-internet/store'
    )
    await updateDoorwayVisibility({ pinSiteId: siteId })
    const pi = await buildPiHomeProjection()
    expect(pi.doorways.find((d) => d.siteId === siteId)?.pinned).toBe(true)
  })

  it('marks a doorway updated-since-last-visit only after a prior visit was recorded', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const siteId = created.siteId!

    // No prior visit recorded yet — nothing should be marked "new" on a
    // first-ever open, even though the site was just created.
    const firstLoad = await buildPiHomeProjection()
    expect(
      firstLoad.doorways.find((d) => d.siteId === siteId)
        ?.updatedSinceLastVisit,
    ).toBeFalsy()

    const { markHomeVisited } = await import(
      '../../src/personal-internet/store'
    )
    await markHomeVisited()

    await applyPiMutation({
      type: 'upsert-record',
      siteId,
      recordType: 'job-application',
      data: { company: 'Acme', stage: 'applied' },
    })

    const afterUpdate = await buildPiHomeProjection()
    expect(
      afterUpdate.doorways.find((d) => d.siteId === siteId)
        ?.updatedSinceLastVisit,
    ).toBe(true)
  })
})
