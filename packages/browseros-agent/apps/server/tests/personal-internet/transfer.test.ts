/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createPersonalInternetRoutes } from '../../src/api/routes/personal-internet'
import { closeDb, getDbHandle, initializeDb } from '../../src/lib/db'
import {
  archivePage,
  archiveSite,
  getPage,
  getSite,
  listPagesForSite,
  listRecords,
  listSites,
  readPageDoc,
  upsertRecord,
  upsertSite,
  writePageDoc,
} from '../../src/personal-internet/store'
import {
  exportPiSites,
  importPiSites,
} from '../../src/personal-internet/transfer'

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Expected test fixture to exist')
  return value
}

describe('PI site import/export', () => {
  let dir: string
  let previousDir: string | undefined
  let app: Hono
  beforeEach(() => {
    previousDir = process.env.BROWSEROS_DIR
    dir = mkdtempSync(join(tmpdir(), 'pi-transfer-'))
    process.env.BROWSEROS_DIR = dir
    closeDb()
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    app = new Hono().route('/pi', createPersonalInternetRoutes())
  })
  afterEach(() => {
    closeDb()
    if (previousDir === undefined) delete process.env.BROWSEROS_DIR
    else process.env.BROWSEROS_DIR = previousDir
    rmSync(dir, { recursive: true, force: true })
  })

  async function seed() {
    const site = await upsertSite({
      name: 'My work',
      slug: 'my-work',
      jtbd: 'Track work',
      templateId: 'blank',
      harvestEnabled: true,
      harvestSources: ['example.com'],
      harvestInstructions: 'Collect updates',
    })
    const record = upsertRecord({
      siteId: site.id,
      type: 'task',
      data: { title: 'Ship feature' },
    })
    await writePageDoc(
      site.id,
      'page_original',
      {
        version: 1,
        title: 'Work board',
        nodes: [
          {
            type: 'board',
            columns: [
              { id: 'todo', title: 'To do', cardIds: [`card_${record.id}`] },
            ],
            cards: [
              {
                id: `card_${record.id}`,
                title: 'Ship feature',
                recordId: record.id,
                actions: [
                  {
                    kind: 'open-internal',
                    route: `#/pi/sites/${site.id}/pages/page_original`,
                  },
                ],
              },
            ],
          },
        ],
      },
      { kind: 'index' },
    )
    await writePageDoc(site.id, 'page_archived', {
      version: 1,
      title: 'Old notes',
      nodes: [{ type: 'text', text: 'Preserve me' }],
      meta: { entityKey: 'old-notes' },
    })
    archivePage('page_archived')
    return { site, record }
  }

  it('round trips pages, records, archived content, and references as an independent copy', async () => {
    const { site, record } = await seed()
    const response = await app.request(`/pi/export?siteId=${site.id}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toContain('attachment')
    const archive = await response.json()
    expect(archive.sites[0].pages).toHaveLength(2)
    expect(JSON.stringify(archive)).not.toContain(dir)
    const imported = await app.request('/pi/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(archive),
    })
    expect(imported.status).toBe(201)
    const { sites } = await imported.json()
    const copyId = sites[0].siteId
    expect(copyId).not.toBe(site.id)
    expect(getSite(copyId)).toMatchObject({
      name: site.name,
      jtbd: site.jtbd,
      harvestEnabled: 0,
      harvestInstructions: 'Collect updates',
    })
    expect(getSite(copyId)?.slug).not.toBe(site.slug)
    expect(getSite(site.id)?.harvestEnabled).toBe(1)
    const [newRecord] = listRecords(copyId)
    expect(newRecord?.id).not.toBe(record.id)
    expect(JSON.parse(newRecord?.dataJson ?? '{}')).toEqual({
      title: 'Ship feature',
    })
    const [page] = listPagesForSite(copyId)
    const doc = await readPageDoc(required(page).id)
    expect(doc?.nodes[0]).toMatchObject({
      columns: [{ cardIds: [`card_${newRecord?.id}`] }],
      cards: [
        {
          id: `card_${newRecord?.id}`,
          recordId: newRecord?.id,
          actions: [
            { action: { route: `#/pi/sites/${copyId}/pages/${page?.id}` } },
          ],
        },
      ],
    })
    const reexport = await exportPiSites(copyId)
    expect(
      reexport.sites[0]?.pages.find((p) => p.status === 'archived')?.doc.meta
        ?.entityKey,
    ).toBe('old-notes')
    expect(
      getDbHandle()
        .sqlite.query('SELECT * FROM pi_index WHERE site_id = ?')
        .all(copyId),
    ).toHaveLength(2)
    const second = await importPiSites(archive)
    expect(second.sites[0]?.siteId).not.toBe(copyId)
    expect(listSites()).toHaveLength(3)
  })

  it('remaps links across a whole-library export and preserves archived sites', async () => {
    const { site } = await seed()
    const other = await upsertSite({ name: 'Other', slug: 'other' })
    await writePageDoc(other.id, 'page_other', {
      version: 1,
      title: 'Linked page',
      nodes: [
        {
          type: 'link',
          label: 'Work',
          action: {
            kind: 'open-internal',
            route: `#/pi/sites/${site.id}/pages/page_original`,
          },
        },
      ],
    })
    archiveSite(other.id)
    const archive = await exportPiSites()
    const { sites } = await importPiSites(archive)
    const copy = required(sites.find((s) => s.name === 'My work'))
    const otherCopy = required(sites.find((s) => s.name === 'Other'))
    expect(getSite(otherCopy.siteId)?.status).toBe('archived')
    const [page] = listPagesForSite(copy.siteId)
    const [otherPage] = listPagesForSite(otherCopy.siteId)
    expect(JSON.stringify(await readPageDoc(required(otherPage).id))).toContain(
      `#/pi/sites/${copy.siteId}/pages/${required(page).id}`,
    )
  })

  it('rejects malformed, unsupported, duplicate-ID, and invalid-page archives before writing', async () => {
    await seed()
    const archive = await exportPiSites()
    for (const body of [
      'not json',
      JSON.stringify({ ...archive, version: 2 }),
      JSON.stringify({
        ...archive,
        sites: [archive.sites[0], archive.sites[0]],
      }),
      JSON.stringify({
        ...archive,
        sites: [
          {
            ...archive.sites[0],
            pages: [
              {
                id: 'page_bad',
                kind: 'index',
                status: 'active',
                doc: { version: 1, title: 'Bad', nodes: [{ type: 'unknown' }] },
              },
            ],
          },
        ],
      }),
      JSON.stringify({
        ...archive,
        sites: [{ ...archive.sites[0], id: '../../outside' }],
      }),
    ]) {
      const response = await app.request('/pi/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      expect(response.status).toBe(400)
      expect(listSites()).toHaveLength(1)
    }
    expect((await app.request('/pi/export?siteId=missing')).status).toBe(404)
  })

  it('rejects oversized uploads without creating sites', async () => {
    const response = await app.request('/pi/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'x'.repeat(16 * 1024 * 1024) }),
    })
    expect(response.status).toBe(413)
    expect(listSites()).toHaveLength(0)
  })

  it('rolls back rows, indexes, and staged files when persistence fails', async () => {
    await seed()
    const archive = await exportPiSites()
    const before = readdirSync(join(dir, 'personal-internet/sites'))
    getDbHandle().sqlite.exec(
      `CREATE TRIGGER fail_import BEFORE INSERT ON pi_pages WHEN NEW.title = 'Old notes' BEGIN SELECT RAISE(ABORT, 'disk simulation'); END`,
    )
    await expect(importPiSites(archive)).rejects.toThrow('disk simulation')
    expect(listSites()).toHaveLength(1)
    expect(readdirSync(join(dir, 'personal-internet/sites'))).toEqual(before)
    expect(
      getDbHandle().sqlite.query('SELECT * FROM pi_index').all(),
    ).toHaveLength(0)
  })

  it('fails export instead of silently omitting unreadable pages', async () => {
    const { site } = await seed()
    writeFileSync(required(getPage('page_archived')).filePath, 'broken JSON')
    await expect(exportPiSites(site.id)).rejects.toThrow('Old notes')
  })
})
