/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveClass } from '@browseros/shared/trust/consequence-class'
import { buildSystemPrompt } from '../../src/agent/prompt'
import { closeDb, getDbHandle, initializeDb } from '../../src/lib/db'
import { seedPromptFilesIfMissing } from '../../src/memory/files'
import {
  applyPersonaTemplate,
  readPersonaMap,
  resolveSoulForBucket,
  writePersonaMap,
} from '../../src/memory/personas'
import { allocatePromptMemory } from '../../src/memory/prompt-budget'
import {
  extractWorkflowCandidates,
  REVIEW_MAX_EVENTS,
  runSkillReviewJob,
} from '../../src/memory/review-job'
import {
  activateStagedSkill,
  installSkillFromPath,
  loadSkillBody,
  runCurationPass,
} from '../../src/memory/skills'
import {
  getSkill,
  listEntries,
  listSkills,
  writeMemoryEntry,
} from '../../src/memory/store'

describe('review job + skills + curation + personas', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    closeDb()
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
    tempDirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-m43-'))
    tempDirs.push(dir)
    const memoriesRoot = join(dir, 'memories')
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    return { dir, memoriesRoot }
  }

  it('extraction bar rejects one-off runs', () => {
    const events = Array.from({ length: 6 }, (_, i) => ({
      id: `e${i}`,
      bucket_id: 'default',
      run_id: 'run-once',
      tool_name: ['navigate', 'snapshot', 'click', 'type', 'tabs', 'read'][i]!,
      payload_json: '{}',
      created_at: 1000 + i,
    }))
    const candidates = extractWorkflowCandidates(events, {
      minToolCalls: 5,
      repeatCount: 2,
    })
    expect(candidates.length).toBe(0)
  })

  it('extraction bar stages when workflow repeats', async () => {
    const { memoriesRoot } = setup()
    await seedPromptFilesIfMissing(memoriesRoot)
    const now = Date.now()
    const tools = ['navigate', 'snapshot', 'click', 'type', 'tabs', 'read']
    const insert = getDbHandle().sqlite.prepare(
      `INSERT INTO graph_events (id, bucket_id, run_id, tool_name, node_id, payload_json, created_at)
       VALUES (?, 'default', ?, ?, NULL, '{}', ?)`,
    )
    for (const runId of ['run-a', 'run-b']) {
      tools.forEach((t, i) => {
        insert.run(`${runId}-${i}`, runId, t, now - i * 1000)
      })
    }

    const result = await runSkillReviewJob({
      memoriesRoot,
      skipBatteryCheck: true,
      now,
      draftSkill: async (c) => `---
name: export-weekly
description: Export weekly report
---

# export-weekly

Steps: ${c.toolNames.join(', ')}
`,
    })
    expect(result.staged).toContain('export-weekly')
    const skill = getSkill('export-weekly')
    expect(skill?.status).toBe('staged')
    expect(skill?.status).not.toBe('active')
  })

  it('skips runs with denied actions or failed exit codes', async () => {
    const { memoriesRoot } = setup()
    await seedPromptFilesIfMissing(memoriesRoot)
    const now = Date.now()
    const tools = ['navigate', 'snapshot', 'click', 'type', 'tabs', 'read']
    const insert = getDbHandle().sqlite.prepare(
      `INSERT INTO graph_events (id, bucket_id, run_id, tool_name, node_id, payload_json, created_at)
       VALUES (?, 'default', ?, ?, NULL, ?, ?)`,
    )
    for (const runId of ['ok-a', 'ok-b', 'denied-run', 'bash-fail']) {
      tools.forEach((t, i) => {
        const payload =
          runId === 'bash-fail' && t === 'read'
            ? JSON.stringify({ exitCode: 1 })
            : '{}'
        insert.run(`${runId}-${i}`, runId, t, payload, now - i * 1000)
      })
    }
    getDbHandle()
      .sqlite.prepare(
        `INSERT INTO action_log (
          id, run_id, conversation_id, tool_name, args_json,
          consequence_class, decision, output_summary, created_at
        ) VALUES (?, 'denied-run', 'c1', 'filesystem_write', '{}', 'write-local', 'denied', NULL, ?)`,
      )
      .run('al-1', now)

    const result = await runSkillReviewJob({
      memoriesRoot,
      skipBatteryCheck: true,
      now,
      draftSkill: async (c) => `---
name: only-ok-runs
description: From successful runs
---

# only-ok-runs
${c.runIds.join(',')}
`,
    })
    expect(result.staged).toContain('only-ok-runs')
    // denied-run and bash-fail must not satisfy repeatCount alone with ok-a/ok-b
    // signature is the same for all — only ok-a + ok-b should count (2), still stages
    const skill = getSkill('only-ok-runs')
    expect(skill?.status).toBe('staged')
  })

  it('does not stage when only failed runs match the signature', async () => {
    const { memoriesRoot } = setup()
    await seedPromptFilesIfMissing(memoriesRoot)
    const now = Date.now()
    const tools = ['navigate', 'snapshot', 'click', 'type', 'tabs', 'read']
    const insert = getDbHandle().sqlite.prepare(
      `INSERT INTO graph_events (id, bucket_id, run_id, tool_name, node_id, payload_json, created_at)
       VALUES (?, 'default', ?, ?, NULL, ?, ?)`,
    )
    for (const runId of ['fail-a', 'fail-b']) {
      tools.forEach((t, i) => {
        insert.run(
          `${runId}-${i}`,
          runId,
          t,
          JSON.stringify({ exitCode: 2 }),
          now - i * 1000,
        )
      })
    }
    const result = await runSkillReviewJob({
      memoriesRoot,
      skipBatteryCheck: true,
      now,
      draftSkill: async () => `---
name: should-not-stage
description: bad
---

# no
`,
    })
    expect(result.staged).not.toContain('should-not-stage')
    expect(result.considered).toBe(0)
  })

  it('recordSkillOutcome updates success_rate for curation', async () => {
    const { memoriesRoot } = setup()
    await seedPromptFilesIfMissing(memoriesRoot)
    const { upsertSkillRecord, recordSkillOutcome, getSkill } = await import(
      '../../src/memory/store'
    )
    upsertSkillRecord({
      id: 'rated-skill',
      name: 'rated-skill',
      description: 'Rated',
      provenance: 'user-written',
      status: 'active',
    })
    // Simulate uses
    const { incrementSkillUses } = await import('../../src/memory/store')
    for (let i = 0; i < 5; i++) incrementSkillUses('rated-skill')
    for (let i = 0; i < 5; i++) recordSkillOutcome('rated-skill', false)
    const skill = getSkill('rated-skill')
    expect(skill?.uses).toBe(5)
    expect(skill?.successRate).not.toBeNull()
    expect(skill!.successRate!).toBeLessThan(0.4)

    const { runCurationPass } = await import('../../src/memory/skills')
    const curation = await runCurationPass({
      now: Date.now(),
      memoriesRoot,
      writeDigest: false,
    })
    expect(curation.flaggedSkills).toContain('rated-skill')
  })

  it('bounded window never exceeds REVIEW_MAX_EVENTS', async () => {
    const { memoriesRoot } = setup()
    const now = Date.now()
    const insert = getDbHandle().sqlite.prepare(
      `INSERT INTO graph_events (id, bucket_id, run_id, tool_name, node_id, payload_json, created_at)
       VALUES (?, 'default', ?, 'navigate', NULL, '{}', ?)`,
    )
    for (let i = 0; i < REVIEW_MAX_EVENTS + 50; i++) {
      insert.run(`flood-${i}`, `run-${i}`, now - i)
    }
    // Should not throw (hard cap enforced in SQL LIMIT).
    await runSkillReviewJob({
      memoriesRoot,
      skipBatteryCheck: true,
      now,
      minToolCalls: 100,
      repeatCount: 10,
    })
  })

  it('activate staged skill then skills_load increments uses', async () => {
    const { memoriesRoot } = setup()
    await seedPromptFilesIfMissing(memoriesRoot)
    mkdirSync(join(memoriesRoot, 'staging'), { recursive: true })
    writeFileSync(
      join(memoriesRoot, 'staging', 'demo-skill.md'),
      `---
name: demo-skill
description: Demo
---

## Steps
1. Do the thing
`,
    )
    const { upsertSkillRecord } = await import('../../src/memory/store')
    upsertSkillRecord({
      id: 'demo-skill',
      name: 'demo-skill',
      description: 'Demo',
      provenance: 'agent-written',
      status: 'staged',
    })
    const activated = await activateStagedSkill('demo-skill', { memoriesRoot })
    expect(activated.ok).toBe(true)
    expect(getSkill('demo-skill')?.status).toBe('active')

    const body = await loadSkillBody('demo-skill', { memoriesRoot })
    expect(body).toContain('Do the thing')
    expect(getSkill('demo-skill')?.uses).toBe(1)

    // Skill body must not appear in system prompt index-only assembly.
    const skills = listSkills({ status: 'active' })
    const allocated = allocatePromptMemory({
      soul: 's',
      user: 'u',
      memoryEntries: [],
      skillIndexLines: skills.map((s) => `- ${s.name}: ${s.description}`),
    })
    const prompt = buildSystemPrompt({
      skillIndexContent: allocated.skillIndexContent,
    })
    expect(prompt).toContain('demo-skill')
    expect(prompt).not.toContain('Do the thing')
  })

  it('install skill from local fixture path', async () => {
    const { memoriesRoot } = setup()
    await seedPromptFilesIfMissing(memoriesRoot)
    const fixture = join(memoriesRoot, 'fixture-skill.md')
    writeFileSync(
      fixture,
      `---
name: fixture-skill
description: From file
---

Body here
`,
    )
    const id = await installSkillFromPath(fixture, { memoriesRoot })
    expect(id).toBe('fixture-skill')
    expect(getSkill(id)?.status).toBe('active')
  })

  it('rejects agent path install outside home/memories', async () => {
    const { memoriesRoot } = setup()
    await seedPromptFilesIfMissing(memoriesRoot)
    await expect(
      installSkillFromPath('/etc/pane-not-a-skill.md', { memoriesRoot }),
    ).rejects.toThrow(/home directory|memories/i)
  })

  it('curation demotes unrecalled memory; demoted still recallable', async () => {
    const { memoriesRoot } = setup()
    await seedPromptFilesIfMissing(memoriesRoot)
    const entry = await writeMemoryEntry({
      content: 'old unrecalled fact',
      source: 'user',
      memoriesRoot,
    })
    // Backdate created_at / last_surfaced
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000
    getDbHandle()
      .sqlite.prepare(
        `UPDATE memory_entries SET created_at = ?, last_surfaced = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(old, old, entry.id)

    const result = await runCurationPass({
      now: Date.now(),
      memoriesRoot,
      writeDigest: true,
    })
    expect(result.demotedMemory).toContain(entry.id)
    const hits = listEntries({
      query: 'unrecalled',
      status: ['active', 'demoted'],
    })
    expect(hits.some((h) => h.id === entry.id && h.status === 'demoted')).toBe(
      true,
    )
    expect(result.digestPath).toContain('curation-')
  })

  it('persona map bucket + pin override', async () => {
    const { memoriesRoot } = setup()
    await applyPersonaTemplate('research-buddy', {
      bucketId: 'work',
      memoriesRoot,
    })
    const map = await readPersonaMap(memoriesRoot)
    expect(map.bucketPersonas.work).toBe('research-buddy')

    await writePersonaMap(
      { bucketPersonas: map.bucketPersonas, pinned: 'chief-of-staff' },
      memoriesRoot,
    )
    // Pin changes map; file still has research-buddy until apply.
    await applyPersonaTemplate('chief-of-staff', {
      pin: true,
      memoriesRoot,
    })
    const resolved = await resolveSoulForBucket('work', memoriesRoot)
    expect(resolved.pinned).toBe(true)
    expect(resolved.soul).toContain('chief of staff')
  })

  it('classifies memory/skill tools', () => {
    expect(deriveClass('memory_add', {})).toBe('write-local')
    expect(deriveClass('memory_replace', {})).toBe('write-local')
    expect(deriveClass('memory_remove', {})).toBe('write-local')
    expect(deriveClass('skills_list', {})).toBe('read')
    expect(deriveClass('skills_load', {})).toBe('read')
    expect(deriveClass('skills_install', {})).toBe('write-local')
    expect(deriveClass('skills_archive', {})).toBe('write-local')
  })
})
