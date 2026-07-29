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

describe('pi schema', () => {
  const dirs: string[] = []
  afterEach(() => {
    closeDb()
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  it('creates pi_* tables on initializeDb', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-schema-'))
    dirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    const tables = getDbHandle()
      .sqlite.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pi_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)
    expect(names).toContain('pi_sites')
    expect(names).toContain('pi_pages')
    expect(names).toContain('pi_records')
    expect(names).toContain('pi_pulses')
    expect(names).toContain('pi_refresh_policies')
    expect(names).toContain('pi_refresh_jobs')
    expect(names).toContain('pi_temps')
  })
})
