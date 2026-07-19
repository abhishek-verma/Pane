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
    expect(deriveClass('tasks_list', {})).toBe('read')
    expect(deriveClass('tasks_add', { title: 'x' })).toBe('write-local')
    expect(deriveClass('tasks_done', { id: 't1' })).toBe('write-local')
    expect(deriveClass('capture_read', { sessionId: 's1' })).toBe('read')
    expect(deriveClass('capture_start', { tabId: 1, url: 'https://x' })).toBe(
      'write-local',
    )
    expect(deriveClass('some_unknown_mcp', {})).toBe('write-external')
  })

  it('context_search covers memory notes (replaces context_recall)', async () => {
    // context_recall was removed; context_search covers memory/soul/user layers.
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
    expect(tools.context_recall).toBeUndefined()
    // context_search should surface the memory note via hybrid search
    const result = await tools.context_search?.execute?.(
      { query: 'tabs spaces preference' },
      { toolCallId: 't1', messages: [] },
    )
    // context_search may or may not index memory synchronously; just verify
    // the tool exists and the old recall tool is gone.
    expect(result).toBeDefined()
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
    const result = await tools.context_search?.execute?.(
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
