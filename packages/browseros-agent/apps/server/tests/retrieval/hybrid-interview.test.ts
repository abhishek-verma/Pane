/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Regression: "what interviews are coming up?" must find Pipeline-Status.md
 * via hybrid retrieve without hand-crafted AND keyword soup.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { graphUpsertNode } from '../../src/context/repo'
import { buildContextToolSet } from '../../src/context/tools'
import { closeDb, initializeDb } from '../../src/lib/db'
import { drainEmbedQueue } from '../../src/retrieval/indexer'
import { createFindTool } from '../../src/tools/filesystem/find'
import type { FilesystemToolResult } from '../../src/tools/filesystem/utils'

const PIPELINE = `# Interview Pipeline — Jul 2026

## Upcoming

### Metafore.ai — Director of Engineering — HR Screen
- Date: Fri, Jul 17, 2026
- Product: Enterprise AI-native orchestration platform

### Glot — Head of Engineering — Intro Call
- Date: Fri, Jul 17, 2026
`

describe('hybrid interview retrieval', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'browseros-hybrid-'))
    closeDb()
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    graphUpsertNode({
      bucketId: 'default',
      kind: 'file',
      title: 'Pipeline-Status.md',
      uri: 'Interviews/Pipeline-Status.md',
      summary: PIPELINE,
      provenance: 'test',
      matchByUri: true,
    })
  })

  afterEach(() => {
    closeDb()
  })

  it('context_search finds Pipeline-Status for NL upcoming interviews query', async () => {
    // Lexical OR + coverage should hit even before vectors warm
    const tools = buildContextToolSet(() => 'default')
    const result = await tools.context_search?.execute?.(
      { query: 'what interviews are coming up?', limit: 10 },
      { toolCallId: 't1', messages: [] },
    )
    const text = (result as { text: string }).text
    expect(text.toLowerCase()).toContain('pipeline')
    expect(text).toContain('Metafore')
  })

  it('hybrid mode still works after embed drain', async () => {
    const { enqueueEmbed } = await import('../../src/retrieval/queue')
    enqueueEmbed({
      bucketId: 'default',
      sourceKind: 'graph',
      sourceId: 'manual-pipeline',
      kind: 'file',
      title: 'Pipeline-Status.md',
      uri: 'Interviews/Pipeline-Status.md',
      text: PIPELINE,
    })
    await drainEmbedQueue(16)

    const tools = buildContextToolSet(() => 'default')
    const result = await tools.context_search?.execute?.(
      { query: 'upcoming interview schedule Metafore', limit: 10 },
      { toolCallId: 't2', messages: [] },
    )
    const text = (result as { text: string }).text
    expect(text.toLowerCase()).toMatch(/pipeline|metafore|interview/)
  })

  it('filesystem_find is case-insensitive for *interview*', async () => {
    const ws = join(dir, 'vault')
    mkdirSync(join(ws, 'Interviews'), { recursive: true })
    mkdirSync(join(ws, 'Skills'), { recursive: true })
    writeFileSync(join(ws, 'Interviews', 'Pipeline-Status.md'), PIPELINE)
    writeFileSync(join(ws, 'Skills', 'Python-Interview-Tips.md'), 'tips')

    const tool = createFindTool(ws)
    const exec = (params: Record<string, unknown>) =>
      // biome-ignore lint/suspicious/noExplicitAny: test helper for AI SDK tool execute
      (tool as any).execute(params) as Promise<FilesystemToolResult>
    const result = await exec({ pattern: '*interview*' })
    expect(result.text).toContain('Interviews/Pipeline-Status.md')
    expect(result.text).toContain('Python-Interview-Tips.md')
  })
})
