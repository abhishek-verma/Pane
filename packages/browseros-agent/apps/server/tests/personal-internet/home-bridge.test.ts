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
    const hide = await tools.pi_home_regions_patch.execute!(
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
})
