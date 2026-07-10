/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load files → allocate budget → frozen prompt snapshot for a session.
 */

import { DEFAULT_BUCKET_ID } from '@browseros/memory/constants'
import { readPromptFiles, seedPromptFilesIfMissing } from './files'
import { allocatePromptMemory, type PromptBudgetResult } from './prompt-budget'
import { bumpSurfaced, listEntries, listSkills } from './store'

export async function loadPromptMemorySnapshot(options: {
  bucketId?: string
  memoriesRoot?: string
}): Promise<PromptBudgetResult> {
  const bucketId = options.bucketId ?? DEFAULT_BUCKET_ID
  await seedPromptFilesIfMissing(options.memoriesRoot)
  const files = await readPromptFiles(options.memoriesRoot)

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

  // If index empty but MEMORY.md has content, use the file as a single slot.
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
    soul: files.soul,
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
