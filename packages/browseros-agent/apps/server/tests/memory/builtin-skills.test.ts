/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initializeDb } from '../../src/lib/db'
import {
  BUILTIN_MEETINGS_SKILL_ID,
  ensureBuiltinSkills,
} from '../../src/memory/builtin-skills'
import { loadSkill } from '../../src/memory/skills'
import { getSkill, listSkills } from '../../src/memory/store'

describe('builtin skills', () => {
  let memoriesRoot: string

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-builtin-skills-'))
    process.env.BROWSEROS_DIR = dir
    memoriesRoot = join(dir, 'memories')
    closeDb()
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  })

  afterEach(() => {
    delete process.env.BROWSEROS_DIR
    closeDb()
  })

  it('seeds the meetings skill and loads it by name', async () => {
    await ensureBuiltinSkills({ memoriesRoot })
    const skill = getSkill(BUILTIN_MEETINGS_SKILL_ID)
    expect(skill?.status).toBe('active')
    expect(skill?.name).toBe('meetings')

    const listed = listSkills({ status: 'active' })
    expect(listed.some((s) => s.id === BUILTIN_MEETINGS_SKILL_ID)).toBe(true)

    const byName = await loadSkill('meetings', { memoriesRoot })
    expect(byName?.id).toBe(BUILTIN_MEETINGS_SKILL_ID)
    expect(byName?.body).toContain('capture_list')
  })
})
