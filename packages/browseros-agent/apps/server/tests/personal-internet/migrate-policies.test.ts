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
  bumpNewDayToD,
  migrateSiteNewDayKindD,
} from '../../src/personal-internet/refresh/migrate-policies'
import { getPolicy, upsertPolicy } from '../../src/personal-internet/store'
import { applyPiMutation } from '../../src/personal-internet/write-path'

describe('pi migrate site new-day kind D', () => {
  const dirs: string[] = []
  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-mig-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('bumpNewDayToD rewrites A to D', () => {
    const next = bumpNewDayToD({
      triggers: [
        { name: 'entity-mutated', kind: 'A' },
        { name: 'new-day', kind: 'A' },
      ],
    })
    expect(next?.triggers.find((t) => t.name === 'new-day')?.kind).toBe('D')
    expect(
      bumpNewDayToD({
        triggers: [{ name: 'new-day', kind: 'D' }],
      }),
    ).toBeNull()
  })

  it('migrateSiteNewDayKindD updates stored site policies', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    // Simulate pre-fix stored policy (new-day A).
    upsertPolicy('site', site.siteId!, {
      triggers: [
        { name: 'entity-mutated', kind: 'A' },
        { name: 'new-day', kind: 'A' },
        { name: 'manual-refresh', kind: 'A' },
      ],
    })
    expect(
      getPolicy('site', site.siteId!)?.triggers.find(
        (t) => t.name === 'new-day',
      )?.kind,
    ).toBe('A')
    expect(migrateSiteNewDayKindD()).toBe(1)
    expect(
      getPolicy('site', site.siteId!)?.triggers.find(
        (t) => t.name === 'new-day',
      )?.kind,
    ).toBe('D')
    expect(migrateSiteNewDayKindD()).toBe(0)
  })
})
