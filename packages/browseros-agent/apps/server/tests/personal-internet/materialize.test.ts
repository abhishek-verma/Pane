/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDbHandle, initializeDb } from '../../src/lib/db'
import {
  ensureAndMaterialize,
  ensureEntityPage,
  finalizeMaterializePageStatus,
  isEntityStubDoc,
} from '../../src/personal-internet/materialize'
import { getPage, readPageDoc } from '../../src/personal-internet/store'
import { applyPiMutation } from '../../src/personal-internet/write-path'

describe('pi materialize', () => {
  const dirs: string[] = []
  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-mat-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('ensureEntityPage creates stub and is idempotent', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Acme', stage: 'applied' },
    })

    const first = await ensureEntityPage(site.siteId!, 'acme')
    expect(first.created).toBe(true)
    expect(first.stub).toBe(true)
    const doc = await readPageDoc(first.pageId)
    expect(isEntityStubDoc(doc)).toBe(true)

    const second = await ensureEntityPage(site.siteId!, 'acme')
    expect(second.created).toBe(false)
    expect(second.pageId).toBe(first.pageId)
  })

  it('ensureAndMaterialize enqueues a pending pi-materialize run', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Globex', stage: 'interviewing' },
    })

    const result = await ensureAndMaterialize(site.siteId!, 'globex')
    expect(result.stub).toBe(true)
    expect(result.runId).toBeTruthy()

    const row = getDbHandle()
      .sqlite.prepare(
        `SELECT id, source, status, prompt FROM scheduled_runs WHERE id = ?`,
      )
      .get(result.runId!) as {
      id: string
      source: string
      status: string
      prompt: string
    }
    expect(row.source).toBe('pi-materialize')
    expect(row.status).toBe('pending')
    expect(row.prompt).toContain('Globex')
    expect(row.prompt).toContain(result.pageId)

    // Remount / retry while pending must reuse the same run (no duplicates).
    const again = await ensureAndMaterialize(site.siteId!, 'globex')
    expect(again.pageId).toBe(result.pageId)
    expect(again.runId).toBe(result.runId)
    const count = getDbHandle()
      .sqlite.prepare(
        `SELECT COUNT(*) AS n FROM scheduled_runs WHERE source = 'pi-materialize'`,
      )
      .get() as { n: number }
    expect(count.n).toBe(1)
  })

  it('finalizeMaterializePageStatus stays refreshing while stub remains', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Umbrella', stage: 'applied' },
    })
    const ensured = await ensureEntityPage(site.siteId!, 'umbrella')
    const still = await finalizeMaterializePageStatus(ensured.pageId, true)
    expect(still).toBe('refreshing')
    expect(getPage(ensured.pageId)?.status).toBe('refreshing')

    await applyPiMutation({
      type: 'patch-page',
      pageId: ensured.pageId,
      ops: [
        {
          op: 'replaceNodes',
          nodes: [
            { type: 'title', text: 'Umbrella' },
            { type: 'text', text: 'Real details' },
          ],
        },
      ],
    })
    const done = await finalizeMaterializePageStatus(ensured.pageId, true)
    expect(done).toBe('active')
    expect(getPage(ensured.pageId)?.status).toBe('active')

    const failed = await finalizeMaterializePageStatus(ensured.pageId, false)
    expect(failed).toBe('error-stale')
  })

  it('ensureAndMaterialize skips enqueue when page is not a stub', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Initech', stage: 'applied' },
    })
    const ensured = await ensureEntityPage(site.siteId!, 'initech')
    // Replace stub body so materialize is skipped.
    await applyPiMutation({
      type: 'patch-page',
      pageId: ensured.pageId,
      ops: [
        {
          op: 'replaceNodes',
          nodes: [
            { type: 'title', text: 'Initech' },
            { type: 'text', text: 'Filled details' },
          ],
        },
      ],
    })

    const result = await ensureAndMaterialize(site.siteId!, 'initech')
    expect(result.stub).toBe(false)
    expect(result.runId).toBeUndefined()
  })
})
