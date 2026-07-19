/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DIGESTS_DIR } from '@browseros/memory/constants'
import { graphAddEvent } from '../../src/context/repo'
import { addTask } from '../../src/context/tasks-repo'
import { closeDb, initializeDb } from '../../src/lib/db'
import { seedPromptFilesIfMissing } from '../../src/memory/files'
import { writeMemoryEntry } from '../../src/memory/store'
import { runDailyDigest } from '../../src/scheduler/digest'

describe('daily digest (M5.2)', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    closeDb()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-digest-'))
    tempDirs.push(dir)
    const memoriesRoot = join(dir, 'memories')
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    return { dir, memoriesRoot }
  }

  it('writes daily-YYYY-MM-DD.md with graph/memory/task content', async () => {
    const { memoriesRoot } = setup()
    await seedPromptFilesIfMissing(memoriesRoot)
    await writeMemoryEntry({
      content: 'prefers dark mode',
      source: 'user',
      memoriesRoot,
    })
    addTask({ title: 'Ship Phase 5' })
    graphAddEvent({
      bucketId: 'default',
      toolName: 'navigate',
      payload: { args: { url: 'https://example.com' } },
    })

    const result = await runDailyDigest({
      memoriesRoot,
      skipBatteryCheck: true,
      skipQuietHours: true,
      force: true,
      notify: async () => {},
    })

    expect(result.path).toBeTruthy()
    expect(result.path).toContain(`${DIGESTS_DIR}/daily-`)
    const content = readFileSync(result.path!, 'utf-8')
    expect(content).toContain('Daily digest')
    expect(content).toContain('Ship Phase 5')
    // Human-readable activity format: either shows 'example.com' (domain) or 'Sites you visited' section
    expect(
      content.includes('example.com') ||
        content.includes('Sites you visited') ||
        content.includes('background action'),
    ).toBe(true)
    expect(content).toContain('prefers dark mode')

    const latest = readFileSync(result.latestPath!, 'utf-8')
    expect(latest).toBe(content)

    // Second run same day overwrites
    const second = await runDailyDigest({
      memoriesRoot,
      skipBatteryCheck: true,
      skipQuietHours: true,
      force: true,
      notify: async () => {},
    })
    expect(second.path).toBe(result.path)
  })
})
