/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Database as BunDatabase } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import {
  flushIngestQueue,
  ingestToolResult,
  isInternalBrowserUrl,
  setIngestPaused,
} from '../../src/context/ingest'
import { closeDb, initializeDb } from '../../src/lib/db'

describe('context graph ingest', () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-ingest-'))
    tempDirs.push(dir)
    closeDb()
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    setIngestPaused(false)
  })

  afterEach(() => {
    flushIngestQueue()
    closeDb()
    setIngestPaused(false)
  })

  it('creates page+tab nodes for navigate', () => {
    ingestToolResult({
      bucketId: DEFAULT_BUCKET_ID,
      toolName: 'navigate',
      args: { url: 'https://example.com/' },
      resultSummary: 'Navigated to example.com',
      browserContext: {
        activeTab: { url: 'https://example.com/', title: 'Example', pageId: 1 },
      },
    })
    flushIngestQueue()

    const nodes = queryNodes()
    expect(
      nodes.some((n) => n.kind === 'page' && n.uri === 'https://example.com/'),
    ).toBe(true)
    expect(nodes.some((n) => n.kind === 'tab')).toBe(true)
    const events = queryEvents()
    expect(events.some((e) => e.tool_name === 'navigate')).toBe(true)
  })

  it('skips ingest when isPrivate is true', () => {
    ingestToolResult({
      bucketId: DEFAULT_BUCKET_ID,
      toolName: 'navigate',
      args: { url: 'https://secret.example/' },
      resultSummary: 'private',
      browserContext: {
        isPrivate: true,
        activeTab: { url: 'https://secret.example/' },
      },
    })
    flushIngestQueue()
    expect(queryNodes().length).toBe(0)
    expect(queryEvents().length).toBe(0)
  })

  it('skips chrome:// page nodes but still allows filesystem ingest', () => {
    ingestToolResult({
      bucketId: DEFAULT_BUCKET_ID,
      toolName: 'navigate',
      args: { url: 'chrome://settings' },
      resultSummary: 'settings',
      browserContext: { activeTab: { url: 'chrome://settings' } },
    })
    ingestToolResult({
      bucketId: DEFAULT_BUCKET_ID,
      toolName: 'filesystem_write',
      args: { path: 'hello.txt', content: 'hi' },
      resultSummary: 'wrote hello.txt',
      workspace: { root: '/tmp/ws' },
    })
    flushIngestQueue()

    const nodes = queryNodes()
    expect(nodes.some((n) => n.kind === 'page')).toBe(false)
    expect(nodes.some((n) => n.kind === 'file' && n.uri === 'hello.txt')).toBe(
      true,
    )
  })

  it('creates terminal_session for filesystem_bash', () => {
    ingestToolResult({
      bucketId: DEFAULT_BUCKET_ID,
      toolName: 'filesystem_bash',
      args: { command: 'ls', sessionId: 'sess-1' },
      resultSummary: 'ok',
    })
    flushIngestQueue()
    const nodes = queryNodes()
    expect(
      nodes.some(
        (n) => n.kind === 'terminal_session' && n.uri === 'terminal:sess-1',
      ),
    ).toBe(true)
  })

  it('detects internal browser URLs', () => {
    expect(isInternalBrowserUrl('chrome://newtab')).toBe(true)
    expect(isInternalBrowserUrl('chrome-extension://abc')).toBe(true)
    expect(isInternalBrowserUrl('about:blank')).toBe(true)
    expect(isInternalBrowserUrl('')).toBe(true)
    expect(isInternalBrowserUrl('https://example.com')).toBe(false)
  })

  function queryNodes(): Array<{ kind: string; uri: string | null }> {
    const handle = initializeDb({
      dbPath: join(tempDirs[tempDirs.length - 1]!, 'browseros.sqlite'),
    })
    return handle.sqlite
      .query<{ kind: string; uri: string | null }, []>(
        'SELECT kind, uri FROM graph_nodes',
      )
      .all()
  }

  function queryEvents(): Array<{ tool_name: string | null }> {
    const handle = initializeDb({
      dbPath: join(tempDirs[tempDirs.length - 1]!, 'browseros.sqlite'),
    })
    return handle.sqlite
      .query<{ tool_name: string | null }, []>(
        'SELECT tool_name FROM graph_events',
      )
      .all()
  }
})

describe('buildIngestGateHooks', () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-wire-ingest-'))
    tempDirs.push(dir)
    closeDb()
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    setIngestPaused(false)
  })

  afterEach(() => {
    flushIngestQueue()
    closeDb()
    setIngestPaused(false)
  })

  it('does not ingest when tool result isError', async () => {
    const { buildIngestGateHooks } = await import(
      '../../src/context/wire-ingest'
    )
    const hooks = buildIngestGateHooks({
      getBucketId: () => DEFAULT_BUCKET_ID,
    })
    hooks.onToolSettled?.({
      toolName: 'filesystem_write',
      args: { path: 'fail.txt', content: 'x' },
      result: { text: 'Path must be relative', isError: true },
      ctx: {
        pins: {},
        runConsequentialCount: { count: 0 },
        isNewUser: true,
        surface: 'loop',
        workspaceRoot: '/tmp/ws',
      },
    })
    flushIngestQueue()
    const handle = initializeDb({
      dbPath: join(tempDirs[tempDirs.length - 1]!, 'browseros.sqlite'),
    })
    const files = handle.sqlite
      .query<{ kind: string }, []>(
        `SELECT kind FROM graph_nodes WHERE kind = 'file'`,
      )
      .all()
    expect(files.length).toBe(0)
  })
})

// Silence unused BunDatabase import if tree-shaken oddly in some runners
void BunDatabase
