/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Database as BunDatabase } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import {
  addEvent,
  currentWork,
  ensureDefaultBucket,
  search,
  toFtsMatchQuery,
  upsertNode,
} from '@browseros/context-graph/repo'

function openMemoryGraphDb(): BunDatabase {
  const db = new BunDatabase(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
    CREATE TABLE buckets (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      kind text DEFAULT 'general' NOT NULL,
      created_at integer NOT NULL
    );
    CREATE TABLE graph_nodes (
      id text PRIMARY KEY NOT NULL,
      bucket_id text NOT NULL REFERENCES buckets(id),
      kind text NOT NULL,
      title text,
      uri text,
      summary text,
      provenance text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE TABLE graph_edges (
      id text PRIMARY KEY NOT NULL,
      bucket_id text NOT NULL REFERENCES buckets(id),
      from_id text NOT NULL REFERENCES graph_nodes(id),
      to_id text NOT NULL REFERENCES graph_nodes(id),
      kind text NOT NULL,
      created_at integer NOT NULL
    );
    CREATE TABLE graph_events (
      id text PRIMARY KEY NOT NULL,
      bucket_id text NOT NULL REFERENCES buckets(id),
      run_id text,
      tool_name text,
      node_id text REFERENCES graph_nodes(id),
      payload_json text NOT NULL,
      created_at integer NOT NULL
    );
    CREATE VIRTUAL TABLE graph_index USING fts5(
      node_id UNINDEXED,
      bucket_id UNINDEXED,
      title,
      uri,
      summary
    );
  `)
  return db
}

describe('context graph store', () => {
  it('auto-creates the default bucket', () => {
    const db = openMemoryGraphDb()
    const bucket = ensureDefaultBucket(db)
    expect(bucket.id).toBe(DEFAULT_BUCKET_ID)
    expect(bucket.name).toBe('Default')
    const again = ensureDefaultBucket(db)
    expect(again.createdAt).toBe(bucket.createdAt)
  })

  it('upserts a node and finds it via FTS search', () => {
    const db = openMemoryGraphDb()
    const node = upsertNode(db, {
      bucketId: DEFAULT_BUCKET_ID,
      kind: 'page',
      title: 'Example Domain',
      uri: 'https://example.com/',
      summary: 'This domain is for use in documentation examples',
      provenance: 'tool:navigate',
      matchByUri: true,
    })

    expect(node.id).toBeTruthy()
    const hits = search(db, DEFAULT_BUCKET_ID, 'documentation examples')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.nodeId).toBe(node.id)
    expect(hits[0]?.uri).toBe('https://example.com/')
    expect(hits[0]?.snippet.length).toBeLessThanOrEqual(500)
  })

  it('filters search by bucket', () => {
    const db = openMemoryGraphDb()
    ensureDefaultBucket(db)
    db.prepare(
      'INSERT INTO buckets (id, name, kind, created_at) VALUES (?, ?, ?, ?)',
    ).run('work', 'Work', 'work', Date.now())

    upsertNode(db, {
      bucketId: DEFAULT_BUCKET_ID,
      kind: 'page',
      title: 'Personal notes',
      uri: 'https://personal.example/notes',
      summary: 'personal shopping list',
      provenance: 'tool:navigate',
      matchByUri: true,
    })
    upsertNode(db, {
      bucketId: 'work',
      kind: 'page',
      title: 'Work deploy runbook',
      uri: 'https://work.example/deploy',
      summary: 'deploy production checklist',
      provenance: 'tool:navigate',
      matchByUri: true,
    })

    const personal = search(db, DEFAULT_BUCKET_ID, 'deploy')
    expect(personal.every((h) => h.bucketId === DEFAULT_BUCKET_ID)).toBe(true)
    expect(personal.some((h) => h.uri?.includes('work.example'))).toBe(false)

    const work = search(db, 'work', 'deploy')
    expect(work.length).toBeGreaterThan(0)
    expect(work[0]?.uri).toContain('work.example')
  })

  it('excludes denied hosts from search', () => {
    const db = openMemoryGraphDb()
    upsertNode(db, {
      bucketId: DEFAULT_BUCKET_ID,
      kind: 'page',
      title: 'Evil',
      uri: 'https://evil.com/phish',
      summary: 'evil phishing page',
      provenance: 'tool:navigate',
      matchByUri: true,
    })
    upsertNode(db, {
      bucketId: DEFAULT_BUCKET_ID,
      kind: 'page',
      title: 'Good',
      uri: 'https://good.com/docs',
      summary: 'evil is a word in good docs too',
      provenance: 'tool:navigate',
      matchByUri: true,
    })

    const hits = search(db, DEFAULT_BUCKET_ID, 'evil', 10, {
      deniedHosts: ['evil.com'],
    })
    expect(hits.every((h) => !h.uri?.includes('evil.com'))).toBe(true)
    expect(hits.some((h) => h.uri?.includes('good.com'))).toBe(true)
  })

  it('currentWork returns recent nodes by kind', () => {
    const db = openMemoryGraphDb()
    upsertNode(db, {
      bucketId: DEFAULT_BUCKET_ID,
      kind: 'file',
      title: 'hello.txt',
      uri: '/tmp/ws/hello.txt',
      provenance: 'tool:filesystem_write',
      matchByUri: true,
    })
    upsertNode(db, {
      bucketId: DEFAULT_BUCKET_ID,
      kind: 'terminal_session',
      title: 'bash',
      uri: 'session:abc',
      provenance: 'tool:filesystem_bash',
      matchByUri: true,
    })
    const work = currentWork(db, DEFAULT_BUCKET_ID)
    expect(work.files.length).toBe(1)
    expect(work.terminal.length).toBe(1)
  })

  it('sanitizes FTS match queries', () => {
    expect(toFtsMatchQuery('')).toBeNull()
    expect(toFtsMatchQuery('  ')).toBeNull()
    expect(toFtsMatchQuery('hello world')).toBe('"hello"* OR "world"*')
    expect(toFtsMatchQuery('drop"table')).toBe('"droptable"*')
  })

  it('ingests 1000 synthetic events and searches under 100ms', () => {
    const db = openMemoryGraphDb()
    ensureDefaultBucket(db)
    for (let i = 0; i < 1000; i++) {
      const node = upsertNode(db, {
        bucketId: DEFAULT_BUCKET_ID,
        kind: i % 2 === 0 ? 'page' : 'file',
        title: `Item ${i} deploy checklist`,
        uri: i % 2 === 0 ? `https://ex.test/p/${i}` : `/ws/file-${i}.ts`,
        summary: `synthetic summary ${i} about deploy and testing`,
        provenance: 'system:ingest',
        matchByUri: true,
      })
      addEvent(db, {
        bucketId: DEFAULT_BUCKET_ID,
        toolName: 'navigate',
        nodeId: node.id,
        payload: { i, summary: `event ${i}` },
      })
    }

    const start = performance.now()
    const hits = search(db, DEFAULT_BUCKET_ID, 'deploy checklist', 10)
    const elapsed = performance.now() - start
    expect(hits.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(100)
  })
})
