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
import { resetPiFocusForTests } from '../../src/personal-internet/focus'
import {
  ensureAndMaterialize,
  ensureEntityPage,
  finalizeMaterializePageStatus,
  isAtfReady,
  isBtfComplete,
  isEntityStubDoc,
} from '../../src/personal-internet/materialize'
import { getPage, readPageDoc } from '../../src/personal-internet/store'
import { applyPiMutation } from '../../src/personal-internet/write-path'

describe('pi materialize', () => {
  const dirs: string[] = []
  afterEach(() => {
    resetPiFocusForTests()
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

  it('ensureEntityPage creates ATF and is idempotent', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Acme', stage: 'applied', role: 'Eng' },
    })

    const first = await ensureEntityPage(site.siteId!, 'acme')
    expect(first.created).toBe(true)
    expect(first.atfReady).toBe(true)
    expect(first.btfComplete).toBe(false)
    const doc = await readPageDoc(first.pageId)
    expect(isAtfReady(doc)).toBe(true)
    expect(doc?.meta?.entityKey).toBe('acme')
    expect(doc?.nodes.some((n) => n.type === 'title')).toBe(true)

    const second = await ensureEntityPage(site.siteId!, 'acme')
    expect(second.created).toBe(false)
    expect(second.pageId).toBe(first.pageId)
  })

  it('refreshes ATF from record while phase is still atf', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const upserted = await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'RefreshCo', stage: 'applied', role: 'Intern' },
    })
    const walkText = (
      nodes: NonNullable<Awaited<ReturnType<typeof readPageDoc>>>['nodes'],
    ): string[] => {
      const out: string[] = []
      for (const n of nodes) {
        if ('text' in n && typeof n.text === 'string') out.push(n.text)
        if (n.type === 'stack') out.push(...walkText(n.children))
      }
      return out
    }
    const first = await ensureEntityPage(site.siteId!, 'refreshco')
    let doc = await readPageDoc(first.pageId)
    expect(walkText(doc!.nodes)).toContain('Intern')

    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      recordId: upserted.recordId,
      data: {
        company: 'RefreshCo',
        stage: 'interviewing',
        role: 'Staff Eng',
        entityKey: 'refreshco',
        pageId: first.pageId,
      },
    })

    await ensureEntityPage(site.siteId!, 'refreshco')
    doc = await readPageDoc(first.pageId)
    expect(doc?.meta?.materialize?.phase).toBe('atf')
    const texts = walkText(doc!.nodes)
    expect(texts).toContain('Staff Eng')
    expect(texts).toContain('interviewing')
  })

  it('does not fuzzy-match entity keys via title includes', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'GreyOrange', stage: 'applied' },
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Orange', stage: 'applied' },
    })

    const grey = await ensureEntityPage(site.siteId!, 'greyorange')
    const orange = await ensureEntityPage(site.siteId!, 'orange')
    expect(grey.pageId).not.toBe(orange.pageId)
  })

  it('does not reuse a page by title equality alone', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    // Orphan entity page with company title but no meta.entityKey / record bind.
    const orphan = await applyPiMutation({
      type: 'create-page',
      mode: 'durable',
      siteId: site.siteId!,
      title: 'Acme',
      kind: 'entity',
      doc: {
        version: 1,
        title: 'Acme',
        nodes: [{ type: 'note', text: 'orphan' }],
      },
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Acme', stage: 'applied', entityKey: 'acme-corp' },
    })

    const ensured = await ensureEntityPage(site.siteId!, 'acme-corp')
    expect(ensured.pageId).not.toBe(orphan.pageId)
    expect(ensured.created).toBe(true)
  })

  it('ensureAndMaterialize enqueues only when materialize:true', async () => {
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

    const atfOnly = await ensureAndMaterialize(site.siteId!, 'globex', {
      materialize: false,
    })
    expect(atfOnly.runId).toBeUndefined()

    const result = await ensureAndMaterialize(site.siteId!, 'globex', {
      materialize: true,
    })
    expect(result.atfReady).toBe(true)
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
    expect(row.prompt).toContain('pi-entity-materialize')
    expect(row.prompt).toContain(result.pageId)

    const again = await ensureAndMaterialize(site.siteId!, 'globex', {
      materialize: true,
    })
    expect(again.pageId).toBe(result.pageId)
    expect(again.runId).toBe(result.runId)
    const count = getDbHandle()
      .sqlite.prepare(
        `SELECT COUNT(*) AS n FROM scheduled_runs WHERE source = 'pi-materialize'`,
      )
      .get() as { n: number }
    expect(count.n).toBe(1)
  })

  it('force-retry cancels the active run before enqueueing', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'ForceCo', stage: 'applied' },
    })
    const first = await ensureAndMaterialize(site.siteId!, 'forceco', {
      materialize: true,
    })
    expect(first.runId).toBeTruthy()

    const forced = await ensureAndMaterialize(site.siteId!, 'forceco', {
      materialize: true,
      force: true,
    })
    expect(forced.runId).toBeTruthy()
    expect(forced.runId).not.toBe(first.runId)

    const old = getDbHandle()
      .sqlite.prepare(`SELECT status, error FROM scheduled_runs WHERE id = ?`)
      .get(first.runId!) as { status: string; error: string | null }
    expect(old.status).toBe('cancelled')
    expect(old.error).toBe('force-retry')
  })

  it('skips enqueue when BTF already complete', async () => {
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
    await applyPiMutation({
      type: 'patch-page',
      pageId: ensured.pageId,
      ops: [
        {
          op: 'setMeta',
          meta: {
            entityKey: 'initech',
            materialize: { phase: 'done', sections: [] },
          },
        },
        {
          op: 'replaceNodes',
          nodes: [
            { type: 'title', text: 'Initech' },
            { type: 'text', text: 'Filled details' },
          ],
        },
      ],
    })

    const result = await ensureAndMaterialize(site.siteId!, 'initech', {
      materialize: true,
    })
    expect(result.btfComplete).toBe(true)
    expect(result.runId).toBeUndefined()
    expect(isBtfComplete(await readPageDoc(ensured.pageId))).toBe(true)
  })

  it('finalizeMaterializePageStatus respects phase done', async () => {
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

    await applyPiMutation({
      type: 'patch-page',
      pageId: ensured.pageId,
      ops: [
        {
          op: 'setMeta',
          meta: {
            entityKey: 'umbrella',
            materialize: { phase: 'done', sections: [] },
          },
        },
      ],
    })
    const done = await finalizeMaterializePageStatus(ensured.pageId, true)
    expect(done).toBe('active')
    expect(getPage(ensured.pageId)?.status).toBe('active')

    const failed = await finalizeMaterializePageStatus(ensured.pageId, false)
    expect(failed).toBe('error-stale')
  })

  it('legacy stub heuristic still works', () => {
    expect(
      isEntityStubDoc({
        version: 1,
        title: 'X',
        nodes: [{ type: 'note', text: 'Preparing details…' }],
      }),
    ).toBe(true)
  })
})
