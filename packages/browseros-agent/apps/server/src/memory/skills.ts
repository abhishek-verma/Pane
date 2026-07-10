/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_BUCKET_ID,
  DIGESTS_DIR,
  MEMORY_MAX_CHARS,
} from '@browseros/memory/constants'
import { logger } from '../lib/logger'
import {
  ensureMemoriesLayout,
  memoriesRoot,
  readSkillFile,
  writeSkillFile,
} from './files'
import { assertMemoryAddFits } from './prompt-budget'
import {
  demoteEntry,
  getSkill,
  incrementSkillUses,
  installSkillFromBody,
  listEntries,
  listSkills,
  parseSkillFrontmatter,
  setSkillStatus,
  upsertSkillRecord,
} from './store'

const UNUSED_SKILL_DAYS = 30
const LOW_SUCCESS_THRESHOLD = 0.4
const LOW_SUCCESS_MIN_USES = 5
const UNRECALLED_MEMORY_DAYS = 30

export async function activateStagedSkill(
  id: string,
  options: { memoriesRoot?: string } = {},
): Promise<{ ok: boolean; error?: string }> {
  const skill = getSkill(id)
  if (!skill || skill.status !== 'staged') {
    return { ok: false, error: `No staged skill: ${id}` }
  }
  const base = memoriesRoot(options.memoriesRoot)
  const stagedPath = join(base, 'staging', `${id}.md`)
  let body: string
  try {
    body = await readFile(stagedPath, 'utf-8')
  } catch {
    return { ok: false, error: `Staged file missing: ${id}` }
  }
  await writeSkillFile(id, body, options.memoriesRoot)
  const { name, description } = parseSkillFrontmatter(body, id)
  upsertSkillRecord({
    id,
    name,
    description,
    provenance: skill.provenance,
    sourceRun: skill.sourceRun,
    bucketId: skill.bucketId,
    status: 'active',
  })
  await rm(stagedPath, { force: true }).catch(() => {})
  return { ok: true }
}

export async function rejectStagedSkill(
  id: string,
  options: { memoriesRoot?: string } = {},
): Promise<void> {
  setSkillStatus(id, 'archived')
  const base = memoriesRoot(options.memoriesRoot)
  await rm(join(base, 'staging', `${id}.md`), { force: true }).catch(() => {})
}

export async function archiveSkill(id: string): Promise<void> {
  setSkillStatus(id, 'archived')
}

export async function loadSkillBody(
  id: string,
  options: { memoriesRoot?: string } = {},
): Promise<string | null> {
  const skill = getSkill(id)
  if (!skill || skill.status === 'archived') return null
  const body = await readSkillFile(id, options.memoriesRoot)
  if (body) incrementSkillUses(id)
  return body
}

export interface CurationResult {
  archivedSkills: string[]
  flaggedSkills: string[]
  demotedMemory: string[]
  digestPath: string | null
}

export async function runCurationPass(
  options: { now?: number; memoriesRoot?: string; writeDigest?: boolean } = {},
): Promise<CurationResult> {
  const now = options.now ?? Date.now()
  const archivedSkills: string[] = []
  const flaggedSkills: string[] = []
  const demotedMemory: string[] = []

  const skills = listSkills({
    status: ['active', 'flagged'],
    limit: 200,
  })
  for (const skill of skills) {
    const ageMs = now - skill.createdAt
    if (skill.uses === 0 && ageMs >= UNUSED_SKILL_DAYS * 24 * 60 * 60 * 1000) {
      setSkillStatus(skill.id, 'archived')
      archivedSkills.push(skill.id)
      continue
    }
    if (
      skill.uses >= LOW_SUCCESS_MIN_USES &&
      skill.successRate != null &&
      skill.successRate < LOW_SUCCESS_THRESHOLD
    ) {
      if (skill.status === 'flagged') {
        setSkillStatus(skill.id, 'archived')
        archivedSkills.push(skill.id)
      } else {
        setSkillStatus(skill.id, 'flagged')
        flaggedSkills.push(skill.id)
      }
    }
  }

  const memories = listEntries({
    layer: 'memory',
    status: 'active',
    limit: 200,
  })
  const unrecalledCutoff = now - UNRECALLED_MEMORY_DAYS * 24 * 60 * 60 * 1000
  for (const entry of memories) {
    const last = entry.lastSurfaced ?? entry.createdAt
    if (last < unrecalledCutoff) {
      demoteEntry(entry.id)
      demotedMemory.push(entry.id)
    }
  }

  let digestPath: string | null = null
  if (options.writeDigest !== false) {
    const base = await ensureMemoriesLayout(options.memoriesRoot)
    const d = new Date(now)
    const stamp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    digestPath = join(base, DIGESTS_DIR, `curation-${stamp}.md`)
    const body = `# Curation digest ${stamp}

- Archived skills: ${archivedSkills.length}${archivedSkills.length ? ` (${archivedSkills.join(', ')})` : ''}
- Flagged skills: ${flaggedSkills.length}${flaggedSkills.length ? ` (${flaggedSkills.join(', ')})` : ''}
- Demoted memory entries: ${demotedMemory.length}

Full proactive delivery lands in Phase 5.
`
    await writeFile(digestPath, body, 'utf-8')
    logger.info('wrote curation digest stub', { digestPath })
  }

  return { archivedSkills, flaggedSkills, demotedMemory, digestPath }
}

export function checkMemoryAddBudget(addition: string): void {
  const active = listEntries({
    layer: 'memory',
    status: 'active',
    limit: 200,
  })
  const current = active.reduce((n, e) => n + e.content.length + 1, 0)
  assertMemoryAddFits(current, addition.length, MEMORY_MAX_CHARS)
}

export async function installSkillFromPath(
  filePath: string,
  options: { id?: string; bucketId?: string; memoriesRoot?: string } = {},
): Promise<string> {
  const body = await readFile(filePath, 'utf-8')
  const parsed = parseSkillFrontmatter(body, 'imported-skill')
  const id =
    options.id ?? parsed.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  await installSkillFromBody({
    id,
    body,
    provenance: 'imported',
    bucketId: options.bucketId ?? DEFAULT_BUCKET_ID,
    memoriesRoot: options.memoriesRoot,
  })
  return id
}
