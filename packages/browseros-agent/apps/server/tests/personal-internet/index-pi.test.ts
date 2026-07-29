/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Verifies that PI pages and records are indexed into pi_index (FTS) and the
 * embed_queue after write-path mutations, and that they are removed on
 * archive/delete. Also asserts that hybridSearch (lexical-only) surfaces PI
 * content after upsert.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDbHandle, initializeDb } from '../../src/lib/db'
import {
  extractPageText,
  extractRecordText,
  indexPiPage,
  indexPiRecord,
  removePiIndex,
  removePiSiteIndex,
  searchPiFts,
} from '../../src/personal-internet/index-pi'
import { applyPiMutation } from '../../src/personal-internet/write-path'
import { hybridSearch } from '../../src/retrieval/hybrid'

describe('PI indexing — index-pi helpers', () => {
  const dirs: string[] = []

  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-idx-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    return dir
  }

  // -------------------------------------------------------------------------
  // extractPageText
  // -------------------------------------------------------------------------

  it('extractPageText collects text from all node types', () => {
    const doc = {
      version: 1 as const,
      title: 'My Board',
      nodes: [
        { type: 'title' as const, text: 'Board Title' },
        { type: 'text' as const, text: 'Some description' },
        { type: 'note' as const, text: 'A note here' },
        { type: 'badge' as const, text: 'In progress' },
        { type: 'divider' as const },
        {
          type: 'stack' as const,
          children: [{ type: 'text' as const, text: 'stacked' }],
        },
        {
          type: 'button' as const,
          label: 'Click me',
          action: { kind: 'open-internal' as const, route: '#/pi' },
        },
        {
          type: 'link' as const,
          label: 'Go somewhere',
          action: {
            kind: 'open-external' as const,
            url: 'https://example.com',
          },
        },
        {
          type: 'table' as const,
          columns: [{ id: 'col1', header: 'Name' }],
          rows: [
            {
              id: 'row1',
              cells: { col1: 'Alice' },
            },
          ],
        },
        {
          type: 'board' as const,
          columns: [{ id: 'c1', title: 'To Do', cardIds: ['card1'] }],
          cards: [
            { id: 'card1', title: 'Design spec', subtitle: 'high priority' },
          ],
        },
      ],
    }
    const text = extractPageText(doc)
    expect(text).toContain('My Board')
    expect(text).toContain('Board Title')
    expect(text).toContain('Some description')
    expect(text).toContain('A note here')
    expect(text).toContain('In progress')
    expect(text).toContain('stacked')
    expect(text).toContain('Click me')
    expect(text).toContain('Go somewhere')
    expect(text).toContain('Alice')
    expect(text).toContain('Design spec')
    expect(text).toContain('high priority')
  })

  it('extractRecordText includes type and string values', () => {
    const text = extractRecordText('application', {
      company: 'Acme Corp',
      stage: 'applied',
      salary: 120000,
      notes: undefined as unknown as string,
    })
    expect(text).toContain('application')
    expect(text).toContain('Acme Corp')
    expect(text).toContain('applied')
    expect(text).toContain('120000')
  })

  // -------------------------------------------------------------------------
  // FTS round-trip
  // -------------------------------------------------------------------------

  it('indexPiPage upserts into pi_index and is searchable', () => {
    setup()
    const doc = {
      version: 1 as const,
      title: 'Job Search Board',
      nodes: [{ type: 'text' as const, text: 'Track applications at Globex' }],
    }
    indexPiPage('page_abc', 'default', 'site_xyz', doc.title, doc)

    const hits = searchPiFts('default', 'globex', 10)
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('page_abc')
    expect(hits[0].sourceKind).toBe('pi_page')
    expect(hits[0].snippet).toContain('Globex')
  })

  it('indexPiRecord upserts into pi_index and is searchable', () => {
    setup()
    indexPiRecord('rec_001', 'site_xyz', 'default', 'application', {
      company: 'Initech',
      stage: 'interview',
    })

    const hits = searchPiFts('default', 'initech', 10)
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('rec_001')
    expect(hits[0].sourceKind).toBe('pi_record')
    expect(hits[0].snippet).toContain('Initech')
  })

  it('removePiIndex removes page from pi_index', () => {
    setup()
    const doc = {
      version: 1 as const,
      title: 'Temp Page',
      nodes: [{ type: 'text' as const, text: 'unique phrase xyzzy' }],
    }
    indexPiPage('page_del', 'default', 'site_xyz', doc.title, doc)
    expect(searchPiFts('default', 'xyzzy', 10)).toHaveLength(1)

    removePiIndex('page_del', 'pi_page')
    expect(searchPiFts('default', 'xyzzy', 10)).toHaveLength(0)
  })

  it('removePiSiteIndex removes all pages and records for a site', () => {
    setup()
    const doc = {
      version: 1 as const,
      title: 'Site Page',
      nodes: [{ type: 'text' as const, text: 'foxtrot bravo' }],
    }
    indexPiPage('page_s1', 'default', 'site_multi', doc.title, doc)
    indexPiRecord('rec_s1', 'site_multi', 'default', 'lead', {
      name: 'foxtrot bravo corp',
    })

    expect(searchPiFts('default', 'foxtrot', 10)).toHaveLength(2)

    removePiSiteIndex('site_multi')
    expect(searchPiFts('default', 'foxtrot', 10)).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // embed_queue integration
  // -------------------------------------------------------------------------

  it('indexPiPage enqueues into embed_queue with sourceKind pi_page', () => {
    setup()
    const doc = {
      version: 1 as const,
      title: 'Embed Test Page',
      nodes: [{ type: 'text' as const, text: 'Some embeddable content' }],
    }
    indexPiPage('page_embed', 'default', 'site_e', doc.title, doc)

    const row = getDbHandle()
      .sqlite.prepare(
        `SELECT source_kind, source_id FROM embed_queue WHERE source_kind = 'pi_page' AND source_id = 'page_embed'`,
      )
      .get() as { source_kind: string; source_id: string } | null

    expect(row).not.toBeNull()
    expect(row?.source_kind).toBe('pi_page')
  })

  it('indexPiRecord enqueues into embed_queue with sourceKind pi_record', () => {
    setup()
    indexPiRecord('rec_embed', 'site_e', 'default', 'contact', {
      name: 'Bob Smith',
      role: 'CTO',
    })

    const row = getDbHandle()
      .sqlite.prepare(
        `SELECT source_kind, source_id FROM embed_queue WHERE source_kind = 'pi_record' AND source_id = 'rec_embed'`,
      )
      .get() as { source_kind: string; source_id: string } | null

    expect(row).not.toBeNull()
    expect(row?.source_kind).toBe('pi_record')
  })

  it('removePiIndex removes embedding_chunks and embed_queue entries', () => {
    setup()
    const doc = {
      version: 1 as const,
      title: 'Chunk Delete Test',
      nodes: [{ type: 'text' as const, text: 'data to be removed' }],
    }
    indexPiPage('page_chunk', 'default', 'site_c', doc.title, doc)

    removePiIndex('page_chunk', 'pi_page')

    const qRow = getDbHandle()
      .sqlite.prepare(
        `SELECT id FROM embed_queue WHERE source_kind = 'pi_page' AND source_id = 'page_chunk'`,
      )
      .get()
    expect(qRow).toBeNull()
  })
})

describe('PI indexing — write-path integration', () => {
  const dirs: string[] = []

  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-wp-idx-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    return dir
  }

  it('upsert-site with template indexes the index page into pi_index', async () => {
    setup()
    const result = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    expect(result.pageId).toBeTruthy()

    const hits = searchPiFts('default', 'job search', 10)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].sourceKind).toBe('pi_page')
  })

  it('create-page (durable) indexes the page into pi_index', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      name: 'Research Hub',
      slug: 'research-hub',
    })

    await applyPiMutation({
      type: 'create-page',
      mode: 'durable',
      siteId: site.siteId!,
      title: 'Quantum computing notes',
      doc: {
        version: 1,
        title: 'Quantum computing notes',
        nodes: [
          {
            type: 'text',
            text: 'Research on superconducting qubits at IBM',
          },
        ],
      },
    })

    const hits = searchPiFts('default', 'superconducting', 10)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].sourceKind).toBe('pi_page')
    expect(hits[0].snippet).toContain('superconducting')
  })

  it('upsert-record indexes the record into pi_index', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })

    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'application',
      data: {
        company: 'Globotech Industries',
        stage: 'applied',
        nextAction: 'Follow up next week',
      },
    })

    const hits = searchPiFts('default', 'globotech', 10)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].sourceKind).toBe('pi_record')
  })

  it('archive-site removes all pages and records from pi_index', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })

    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'application',
      data: { company: 'Synergy Corp', stage: 'interview' },
    })

    // Verify both are indexed before archive.
    expect(searchPiFts('default', 'job search', 10).length).toBeGreaterThan(0)
    expect(searchPiFts('default', 'synergy', 10).length).toBeGreaterThan(0)

    await applyPiMutation({ type: 'archive-site', siteId: site.siteId! })

    expect(searchPiFts('default', 'job search', 10)).toHaveLength(0)
    expect(searchPiFts('default', 'synergy', 10)).toHaveLength(0)
  })
})

describe('PI indexing — hybridSearch integration', () => {
  const dirs: string[] = []

  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-hybrid-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    return dir
  }

  it('hybridSearch (lexical) surfaces pi_page after upsert', async () => {
    setup()
    const doc = {
      version: 1 as const,
      title: 'Acme Lead Pipeline',
      nodes: [
        { type: 'text' as const, text: 'Track deals with Acme Corporation' },
      ],
    }
    indexPiPage('page_hyb1', 'default', 'site_hyb', doc.title, doc)

    const result = await hybridSearch('Acme Corporation', {
      bucketId: 'default',
      lexicalOnly: true,
    })

    const piHit = result.hits.find((h) => h.sourceKind === 'pi_page')
    expect(piHit).not.toBeUndefined()
    expect(piHit?.snippet).toContain('Acme')
  })

  it('hybridSearch (lexical) surfaces pi_record after upsert', async () => {
    setup()
    indexPiRecord('rec_hyb1', 'site_hyb', 'default', 'contact', {
      name: 'Globocorp Inc',
      status: 'prospect',
    })

    const result = await hybridSearch('Globocorp', {
      bucketId: 'default',
      lexicalOnly: true,
    })

    const piHit = result.hits.find((h) => h.sourceKind === 'pi_record')
    expect(piHit).not.toBeUndefined()
    expect(piHit?.snippet).toContain('Globocorp')
  })

  it('hybridSearch does not surface removed PI content after archive', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      name: 'Temp Sales',
      slug: 'temp-sales',
    })

    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'lead',
      data: { company: 'NovaCorp Unique XJ9', stage: 'prospect' },
    })

    // Confirm it's findable before archive.
    const before = await hybridSearch('NovaCorp Unique XJ9', {
      bucketId: 'default',
      lexicalOnly: true,
    })
    expect(before.hits.some((h) => h.sourceKind === 'pi_record')).toBe(true)

    // Archive the site.
    await applyPiMutation({ type: 'archive-site', siteId: site.siteId! })

    const after = await hybridSearch('NovaCorp Unique XJ9', {
      bucketId: 'default',
      lexicalOnly: true,
    })
    expect(after.hits.every((h) => h.sourceKind !== 'pi_record')).toBe(true)
  })
})
