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
import { applyPiMutation } from '../../src/personal-internet/write-path'
import { loadHomeWidgets } from '../../src/scheduler/home'

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

  it('doorway appears after P0 site create; widgets still present', async () => {
    const dir = setup()
    await applyPiMutation({ type: 'upsert-site', templateId: 'job-search' })
    const pi = await buildPiHomeProjection()
    expect(pi.doorways.length).toBeGreaterThanOrEqual(1)
    expect(pi.doorways[0]?.name).toBe('Job Search')
    expect(pi.doorways[0]?.primaryRoute).toContain('#/pi/sites/')
    expect(pi.libraryCount).toBe(1)

    const home = await loadHomeWidgets({ memoriesRoot: join(dir, 'memories') })
    expect(Array.isArray(home.widgets)).toBe(true)
    expect(home.widgets.some((w) => w.type === 'recent-sites-fallback')).toBe(
      true,
    )
    expect(home.pi).toBeTruthy()
    expect(home.pi.doorways.length).toBeGreaterThanOrEqual(1)
  })
})
