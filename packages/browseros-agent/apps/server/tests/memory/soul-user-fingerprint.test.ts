/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initializeDb } from '../../src/lib/db'
import {
  seedPromptFilesIfMissing,
  writePromptFile,
} from '../../src/memory/files'
import { getSoulUserFingerprint } from '../../src/memory/load-prompt'
import { applyPersonaTemplate } from '../../src/memory/personas'

describe('getSoulUserFingerprint', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    closeDb()
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
    tempDirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-soul-user-fingerprint-'))
    tempDirs.push(dir)
    const memoriesRoot = join(dir, 'memories')
    initializeDb({ dbPath: join(dir, 'db.sqlite') })
    return { memoriesRoot }
  }

  it('is stable across repeated calls with no changes', async () => {
    const { memoriesRoot } = setup()
    await seedPromptFilesIfMissing(memoriesRoot)
    const first = await getSoulUserFingerprint({ memoriesRoot })
    const second = await getSoulUserFingerprint({ memoriesRoot })
    expect(second).toBe(first)
  })

  it('changes when SOUL.md is edited (soul_edit / Settings page)', async () => {
    const { memoriesRoot } = setup()
    await seedPromptFilesIfMissing(memoriesRoot)
    const before = await getSoulUserFingerprint({ memoriesRoot })
    await writePromptFile('soul', '# Soul\nBe extremely terse.', memoriesRoot)
    const after = await getSoulUserFingerprint({ memoriesRoot })
    expect(after).not.toBe(before)
  })

  it('changes when USER.md is edited (user_edit / Settings page)', async () => {
    const { memoriesRoot } = setup()
    await seedPromptFilesIfMissing(memoriesRoot)
    const before = await getSoulUserFingerprint({ memoriesRoot })
    await writePromptFile('user', '# User\n- Name: Ada', memoriesRoot)
    const after = await getSoulUserFingerprint({ memoriesRoot })
    expect(after).not.toBe(before)
  })

  it('reflects the resolved persona template when SOUL.md has never been written', async () => {
    // SOUL.md is seeded with DEFAULT_SOUL_TEMPLATE by seedPromptFilesIfMissing
    // in every other test here, so this exercises the rarer branch directly:
    // no file at all, resolved purely from the bucket's persona-map entry.
    const { memoriesRoot } = setup()
    const soulPath = join(memoriesRoot, 'SOUL.md')

    await applyPersonaTemplate('research-buddy', {
      bucketId: 'default',
      memoriesRoot,
    })
    // applyPersonaTemplate writes SOUL.md as a side effect (it's how persona
    // switching works); an empty/whitespace body fails the injection scan
    // (assertMemoryContent rejects "empty content"), so delete the file
    // directly to hit the file-empty branch instead.
    unlinkSync(soulPath)
    const withResearchPersona = await getSoulUserFingerprint({
      bucketId: 'default',
      memoriesRoot,
    })

    await applyPersonaTemplate('chief-of-staff', {
      bucketId: 'default',
      memoriesRoot,
    })
    unlinkSync(soulPath)
    const withChiefOfStaffPersona = await getSoulUserFingerprint({
      bucketId: 'default',
      memoriesRoot,
    })

    expect(withChiefOfStaffPersona).not.toBe(withResearchPersona)
  })
})
