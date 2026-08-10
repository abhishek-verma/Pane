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
import { upsertSkillRecord } from '../../src/memory/store'
import { loadHome } from '../../src/scheduler/home'

describe('home growth counters', () => {
  const dirs: string[] = []
  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'home-growth-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    return dir
  }

  it('reports zero growth on a fresh profile', async () => {
    setup()
    const home = await loadHome()
    expect(home.growth).toEqual({
      skillsLearned: 0,
      memoriesCount: 0,
      sitesActive: 0,
    })
  })

  it('counts active skills', async () => {
    setup()
    upsertSkillRecord({
      id: 'skill-1',
      name: 'Book a flight',
      description: 'Book a flight',
      provenance: 'agent-written',
      status: 'active',
    })
    const home = await loadHome()
    expect(home.growth.skillsLearned).toBe(1)
  })
})
