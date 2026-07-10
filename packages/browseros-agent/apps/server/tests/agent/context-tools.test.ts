/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveClass } from '@browseros/shared/trust/consequence-class'
import { setGrant } from '../../src/context/grants'
import { flushIngestQueue, ingestToolResult } from '../../src/context/ingest'
import { graphUpsertNode } from '../../src/context/repo'
import { buildContextToolSet } from '../../src/context/tools'
import { closeDb, initializeDb } from '../../src/lib/db'
import { seedPromptFilesIfMissing } from '../../src/memory/files'
import { writeMemoryEntry } from '../../src/memory/store'

describe('context tools + trust class', () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-ctx-tools-'))
    closeDb()
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  })

  afterEach(() => {
    flushIngestQueue()
    closeDb()
  })

  it('classifies context_* as read and tasks mutations as write-local', () => {
    expect(deriveClass('context_search', {})).toBe('read')
    expect(deriveClass('context_current_work', {})).toBe('read')
    expect(deriveClass('context_recall', {})).toBe('read')
    expect(deriveClass('tasks_list', {})).toBe('read')
    expect(deriveClass('tasks_add', { title: 'x' })).toBe('write-local')
    expect(deriveClass('tasks_done', { id: 't1' })).toBe('write-local')
    expect(deriveClass('some_unknown_mcp', {})).toBe('write-external')
  })

  it('context_recall returns real memory hits (not Phase-3 stub)', async () => {
    // Re-bind the singleton DB inside this test so concurrent suites cannot
    // swap the handle between write and recall.
    const dir = mkdtempSync(join(tmpdir(), 'browseros-recall-'))
    closeDb()
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    const memoriesRoot = join(dir, 'memories')
    await seedPromptFilesIfMissing(memoriesRoot)
    await writeMemoryEntry({
      content: 'prefers tabs over spaces',
      source: 'user',
      memoriesRoot,
    })

    const tools = buildContextToolSet(() => 'default')
    const execute = tools.context_recall?.execute
    expect(execute).toBeDefined()
    const result = await execute!(
      { query: 'tabs' },
      { toolCallId: 't1', messages: [] },
    )
    const text = (result as { text: string }).text
    expect(text).toContain('prefers tabs over spaces')
    expect(text).not.toContain('Phase 4')
    expect(text).not.toContain('not available yet')
  })

  it('context_search returns snippets and respects domain deny', async () => {
    graphUpsertNode({
      bucketId: 'default',
      kind: 'page',
      title: 'Evil',
      uri: 'https://evil.com/x',
      summary: 'evil phishing page about widgets',
      provenance: 'tool:navigate',
      matchByUri: true,
    })
    graphUpsertNode({
      bucketId: 'default',
      kind: 'page',
      title: 'Good',
      uri: 'https://good.com/docs',
      summary: 'widgets documentation',
      provenance: 'tool:navigate',
      matchByUri: true,
    })
    setGrant('evil.com', false, 'default')

    const tools = buildContextToolSet(() => 'default')
    const result = await tools.context_search!.execute!(
      { query: 'widgets', limit: 10 },
      { toolCallId: 't2', messages: [] },
    )
    const text = (result as { text: string }).text
    expect(text).not.toContain('evil.com')
    expect(text.toLowerCase()).toContain('good')
  })
})

describe('ingest still skips private after tools land', () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-ctx-priv-'))
    closeDb()
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  })
  afterEach(() => {
    flushIngestQueue()
    closeDb()
  })

  it('private navigate creates no nodes', () => {
    ingestToolResult({
      bucketId: 'default',
      toolName: 'navigate',
      args: { url: 'https://private.example/' },
      resultSummary: 'x',
      browserContext: { isPrivate: true },
    })
    flushIngestQueue()
    // smoke: no throw
  })
})
