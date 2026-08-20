/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load files → allocate budget → frozen prompt snapshot for a session.
 */

import { createHash } from 'node:crypto'
import { DEFAULT_BUCKET_ID } from '@browseros/memory/constants'
import { ensureBuiltinSkills } from './builtin-skills'
import { readPromptFiles, seedPromptFilesIfMissing } from './files'
import {
  getPersonaTemplate,
  readPersonaMap,
  resolveSoulForBucket,
} from './personas'
import { allocatePromptMemory, type PromptBudgetResult } from './prompt-budget'
import { activateAllStagedSkills } from './skills'
import { bumpSurfaced, listEntries, listSkills } from './store'

export async function loadPromptMemorySnapshot(options: {
  bucketId?: string
  memoriesRoot?: string
}): Promise<PromptBudgetResult> {
  const bucketId = options.bucketId ?? DEFAULT_BUCKET_ID
  await seedPromptFilesIfMissing(options.memoriesRoot)
  // Avoid racing startup's fire-and-forget seed: skill index must include builtins.
  await ensureBuiltinSkills({ memoriesRoot: options.memoriesRoot })
  // One-time migration for installs upgrading from the removed staging gate —
  // no-op once nothing is left in 'staged' status.
  await activateAllStagedSkills(options.memoriesRoot)
  const files = await readPromptFiles(options.memoriesRoot)
  const soulResolved = await resolveSoulForBucket(
    bucketId,
    options.memoriesRoot,
  )

  const memoryEntries = listEntries({
    bucketId,
    layer: 'memory',
    status: ['active'],
    limit: 100,
  }).map((e) => ({
    id: e.id,
    content: e.content,
    usefulness: e.usefulness,
    lastSurfaced: e.lastSurfaced,
    createdAt: e.createdAt,
  }))

  if (memoryEntries.length === 0 && files.memory.trim()) {
    memoryEntries.push({
      id: 'file:MEMORY.md',
      content: files.memory.trim(),
      usefulness: 0,
      lastSurfaced: null,
      createdAt: 0,
    })
  }

  const skills = listSkills({ bucketId, status: 'active', limit: 80 })
  const skillIndexLines = skills.map(
    (s) => `- ${s.name}: ${s.description.slice(0, 120)}`,
  )

  const allocated = allocatePromptMemory({
    soul: soulResolved.soul || files.soul,
    user: files.user,
    memoryEntries,
    skillIndexLines,
  })

  const realIds = allocated.includedMemoryIds.filter(
    (id) => !id.startsWith('file:'),
  )
  if (realIds.length > 0) {
    bumpSurfaced(realIds, 0.5)
  }

  return allocated
}

/**
 * Cheap content stamp for SOUL.md + USER.md, used to detect edits made
 * mid-conversation (via `soul_edit`/`user_edit` or the Settings page) so the
 * chat service can rebuild the frozen system prompt instead of silently
 * running the rest of the conversation against stale persona/profile text.
 *
 * Runs on every chat turn, so it reads the prompt files exactly once —
 * `resolveSoulForBucket` also reads them internally to resolve the same
 * "file wins over persona template" fallback, so calling it here as well
 * would double every SOUL.md/USER.md/MEMORY.md read on the hot path for no
 * benefit (the persona template only matters when SOUL.md has never been
 * written, which `seedPromptFilesIfMissing` makes rare in practice).
 */
export async function getSoulUserFingerprint(options: {
  bucketId?: string
  memoriesRoot?: string
}): Promise<string> {
  const bucketId = options.bucketId ?? DEFAULT_BUCKET_ID
  const files = await readPromptFiles(options.memoriesRoot)
  let soul = files.soul
  if (!soul.trim()) {
    const map = await readPersonaMap(options.memoriesRoot)
    const personaId = map.pinned ?? map.bucketPersonas[bucketId] ?? 'default'
    soul = getPersonaTemplate(personaId)?.body ?? ''
  }
  const raw = `${soul} ${files.user}`
  return createHash('sha1').update(raw).digest('hex')
}
