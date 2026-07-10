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
import {
  readPromptFiles,
  seedPromptFilesIfMissing,
} from '../../src/memory/files'
import {
  applyPersonaTemplate,
  readPersonaMap,
  resolveSoulForBucket,
} from '../../src/memory/personas'

describe('onboarding ICP → persona seed (server side)', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    closeDb()
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
    tempDirs.length = 0
  })

  it('applyPersonaTemplate for research seeds SOUL.md and map', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-icp-seed-'))
    tempDirs.push(dir)
    const memoriesRoot = join(dir, 'memories')
    initializeDb({ dbPath: join(dir, 'db.sqlite') })
    await seedPromptFilesIfMissing(memoriesRoot)

    await applyPersonaTemplate('research-buddy', {
      bucketId: 'default',
      memoriesRoot,
    })

    const files = await readPromptFiles(memoriesRoot)
    expect(files.soul).toContain('research buddy')
    const map = await readPersonaMap(memoriesRoot)
    expect(map.bucketPersonas.default).toBe('research-buddy')
    const resolved = await resolveSoulForBucket('default', memoriesRoot)
    expect(resolved.soul).toContain('research buddy')
  })
})
