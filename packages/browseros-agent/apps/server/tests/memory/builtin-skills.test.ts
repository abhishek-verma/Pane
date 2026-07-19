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
  BUILTIN_BROWSER_OBSERVE_SKILL_ID,
  BUILTIN_MEETINGS_SKILL_ID,
  BUILTIN_MEMORY_SKILL_ID,
  ensureBuiltinSkills,
} from '../../src/memory/builtin-skills'
import { loadSkill } from '../../src/memory/skills'
import { getSkill, listSkills, setSkillStatus } from '../../src/memory/store'

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

  it('seeds meetings, browser-observe, and memory skills', async () => {
    await ensureBuiltinSkills({ memoriesRoot })
    const meetings = getSkill(BUILTIN_MEETINGS_SKILL_ID)
    expect(meetings?.status).toBe('active')
    expect(meetings?.name).toBe('meetings')

    const listed = listSkills({ status: 'active' })
    expect(listed.some((s) => s.id === BUILTIN_MEETINGS_SKILL_ID)).toBe(true)
    expect(listed.some((s) => s.id === BUILTIN_BROWSER_OBSERVE_SKILL_ID)).toBe(
      true,
    )
    expect(listed.some((s) => s.id === BUILTIN_MEMORY_SKILL_ID)).toBe(true)

    const byName = await loadSkill('meetings', { memoriesRoot })
    expect(byName?.id).toBe(BUILTIN_MEETINGS_SKILL_ID)
    expect(byName?.body).toContain('capture_list')

    const browser = await loadSkill('browser-observe', { memoriesRoot })
    expect(browser?.id).toBe(BUILTIN_BROWSER_OBSERVE_SKILL_ID)
    expect(browser?.body).toContain('evaluate')
    expect(browser?.body).toContain('page ID from Browser Context')
    expect(browser?.body).not.toMatch(/Find pages with `tabs` action="list"/i)

    const memory = await loadSkill('memory', { memoriesRoot })
    expect(memory?.id).toBe(BUILTIN_MEMORY_SKILL_ID)
    expect(memory?.body).toContain('memory_add')
  })

  it('does not reactivate an archived builtin skill', async () => {
    await ensureBuiltinSkills({ memoriesRoot })
    setSkillStatus(BUILTIN_MEETINGS_SKILL_ID, 'archived')
    await ensureBuiltinSkills({ memoriesRoot })
    expect(getSkill(BUILTIN_MEETINGS_SKILL_ID)?.status).toBe('archived')
  })
})
