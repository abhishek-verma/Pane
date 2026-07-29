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
  BUILTIN_PERSONALISED_INTERNET_SKILL_ID,
  BUILTIN_PI_HOME_SKILL_ID,
  BUILTIN_PI_PAGE_DSL_SKILL_ID,
  BUILTIN_PI_PAGE_PATCH_SKILL_ID,
  BUILTIN_PI_PAGE_VIZ_SKILL_ID,
  BUILTIN_PI_SITES_SKILL_ID,
  BUILTIN_RESEARCH_SKILL_ID,
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

  it('seeds core + focused pi-* skills; archives mega personalised-internet', async () => {
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
    expect(listed.some((s) => s.id === BUILTIN_RESEARCH_SKILL_ID)).toBe(true)
    expect(listed.some((s) => s.id === BUILTIN_PI_SITES_SKILL_ID)).toBe(true)
    expect(listed.some((s) => s.id === BUILTIN_PI_PAGE_DSL_SKILL_ID)).toBe(true)
    expect(listed.some((s) => s.id === BUILTIN_PI_PAGE_PATCH_SKILL_ID)).toBe(
      true,
    )
    expect(listed.some((s) => s.id === BUILTIN_PI_HOME_SKILL_ID)).toBe(true)
    expect(listed.some((s) => s.id === BUILTIN_PI_PAGE_VIZ_SKILL_ID)).toBe(true)
    expect(
      listed.some((s) => s.id === BUILTIN_PERSONALISED_INTERNET_SKILL_ID),
    ).toBe(false)

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

    const research = await loadSkill('research', { memoriesRoot })
    expect(research?.id).toBe(BUILTIN_RESEARCH_SKILL_ID)
    expect(research?.body).toContain('context_search')
    expect(research?.body).toContain('search angles')
    expect(research?.body).toContain('background tabs')
    expect(research?.body).toContain('cited sources')

    const sites = await loadSkill('pi-sites', { memoriesRoot })
    expect(sites?.id).toBe(BUILTIN_PI_SITES_SKILL_ID)
    expect(sites?.body).toContain('templateId')
    expect(sites?.body).toContain('pi_preserve_temp')

    const dsl = await loadSkill('pi-page-dsl', { memoriesRoot })
    expect(dsl?.id).toBe(BUILTIN_PI_PAGE_DSL_SKILL_ID)
    expect(dsl?.body).toContain('closed element set')
    expect(dsl?.body).toContain('open-internal')

    const patch = await loadSkill('pi-page-patch', { memoriesRoot })
    expect(patch?.id).toBe(BUILTIN_PI_PAGE_PATCH_SKILL_ID)
    expect(patch?.body).toContain('first')
    expect(patch?.body).toContain('upsertBoardCard')

    const home = await loadSkill('pi-home', { memoriesRoot })
    expect(home?.id).toBe(BUILTIN_PI_HOME_SKILL_ID)
    expect(home?.body).toContain('pi_home_regions_patch')
    expect(home?.body).toContain('continuity')
    expect(home?.body).toContain('doorway')

    const viz = await loadSkill('pi-page-viz', { memoriesRoot })
    expect(viz?.id).toBe(BUILTIN_PI_PAGE_VIZ_SKILL_ID)
    expect(viz?.body).toContain('chartType')
    expect(viz?.body).toContain('mermaid')
    expect(viz?.body).toContain('sanitize')
  })

  it('archives previously installed personalised-internet mega-skill', async () => {
    await installLegacyMegaSkill(memoriesRoot)
    expect(getSkill(BUILTIN_PERSONALISED_INTERNET_SKILL_ID)?.status).toBe(
      'active',
    )
    await ensureBuiltinSkills({ memoriesRoot })
    expect(getSkill(BUILTIN_PERSONALISED_INTERNET_SKILL_ID)?.status).toBe(
      'archived',
    )
  })

  it('does not reactivate an archived builtin skill', async () => {
    await ensureBuiltinSkills({ memoriesRoot })
    setSkillStatus(BUILTIN_MEETINGS_SKILL_ID, 'archived')
    await ensureBuiltinSkills({ memoriesRoot })
    expect(getSkill(BUILTIN_MEETINGS_SKILL_ID)?.status).toBe('archived')
  })
})

async function installLegacyMegaSkill(memoriesRoot: string): Promise<void> {
  const { installSkillFromBody } = await import('../../src/memory/store')
  await installSkillFromBody({
    id: BUILTIN_PERSONALISED_INTERNET_SKILL_ID,
    body: `---
name: personalised-internet
description: legacy mega skill
---

# Legacy
`,
    provenance: 'imported',
    memoriesRoot,
  })
}
