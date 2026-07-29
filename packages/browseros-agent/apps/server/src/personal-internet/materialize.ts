/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Lazy entity pages: ensure stub + enqueue materialize agent run.
 */

import { getDbHandle } from '../lib/db'
import { logger } from '../lib/logger'
import { entityRoute, pageRoute } from './paths'
import {
  findRecordByEntityKey,
  normalizeJobSearchRecord,
  parseRecordData,
} from './records'
import {
  getPage,
  getSite,
  listPagesForSite,
  newPiId,
  readPageDoc,
  upsertRecord,
} from './store'
import type { PiPageDoc } from './types'
import { applyPiMutation } from './write-path'

function sqlite() {
  return getDbHandle().sqlite
}

const STUB_NOTE = 'Preparing details…'

export function isEntityStubDoc(doc: PiPageDoc | null | undefined): boolean {
  if (!doc) return true
  return doc.nodes.some(
    (n) => n.type === 'note' && n.text.includes('Preparing details'),
  )
}

export function buildEntityStubDoc(company: string): PiPageDoc {
  return {
    version: 1,
    title: company,
    nodes: [
      { type: 'title', text: company },
      { type: 'note', text: STUB_NOTE },
    ],
  }
}

export type EnsureEntityPageResult = {
  pageId: string
  route: string
  entityRoute: string
  created: boolean
  stub: boolean
  recordId: string | null
  company: string
}

/** Find or create a durable entity page stub for entityKey; bind pageId on record. */
export async function ensureEntityPage(
  siteId: string,
  entityKey: string,
): Promise<EnsureEntityPageResult> {
  const site = getSite(siteId)
  if (!site || site.status === 'archived' || site.status === 'deleted') {
    throw new Error('site not found or archived')
  }
  const key = decodeURIComponent(entityKey).trim()
  if (!key) throw new Error('entityKey required')

  const record = findRecordByEntityKey(siteId, key)
  let company = key
  let data: Record<string, unknown> = {}
  if (record) {
    data = parseRecordData(record)
    try {
      company = normalizeJobSearchRecord(data).company
    } catch {
      company = String(data.company ?? data.name ?? key)
    }
    if (typeof data.pageId === 'string' && data.pageId) {
      const existing = getPage(data.pageId)
      if (existing && existing.siteId === siteId) {
        const doc = await readPageDoc(existing.id)
        return {
          pageId: existing.id,
          route: pageRoute(siteId, existing.id),
          entityRoute: entityRoute(siteId, key),
          created: false,
          stub: isEntityStubDoc(doc),
          recordId: record.id,
          company,
        }
      }
    }
  }

  // Match existing entity page by title / kind
  const pages = listPagesForSite(siteId)
  const match = pages.find(
    (p) =>
      p.kind === 'entity' &&
      (p.title.toLowerCase() === company.toLowerCase() ||
        p.title.toLowerCase().includes(key.toLowerCase())),
  )
  if (match) {
    if (record) {
      upsertRecord({
        id: record.id,
        siteId,
        type: record.type,
        data: { ...data, pageId: match.id, entityKey: key },
      })
    }
    const doc = await readPageDoc(match.id)
    return {
      pageId: match.id,
      route: pageRoute(siteId, match.id),
      entityRoute: entityRoute(siteId, key),
      created: false,
      stub: isEntityStubDoc(doc),
      recordId: record?.id ?? null,
      company,
    }
  }

  const stub = buildEntityStubDoc(company)
  const created = await applyPiMutation({
    type: 'create-page',
    mode: 'durable',
    siteId,
    title: company,
    doc: stub,
    kind: 'entity',
  })
  if (!created.pageId) throw new Error('failed to create entity page')

  if (record) {
    upsertRecord({
      id: record.id,
      siteId,
      type: record.type,
      data: { ...data, pageId: created.pageId, entityKey: key },
    })
  }

  setPageStatus(created.pageId, 'refreshing')

  return {
    pageId: created.pageId,
    route: pageRoute(siteId, created.pageId),
    entityRoute: entityRoute(siteId, key),
    created: true,
    stub: true,
    recordId: record?.id ?? null,
    company,
  }
}

export function setPageStatus(pageId: string, status: string): void {
  const page = getPage(pageId)
  if (!page) return
  sqlite()
    .prepare(`UPDATE pi_pages SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, Date.now(), pageId)
}

/**
 * After a pi-materialize run finishes: mark active only when the stub note
 * is gone. Otherwise leave refreshing / mark error-stale so UI stays honest.
 */
export async function finalizeMaterializePageStatus(
  pageId: string,
  runOk: boolean,
): Promise<'active' | 'refreshing' | 'error-stale'> {
  const doc = await readPageDoc(pageId)
  if (!runOk) {
    setPageStatus(pageId, 'error-stale')
    return 'error-stale'
  }
  if (isEntityStubDoc(doc)) {
    setPageStatus(pageId, 'refreshing')
    return 'refreshing'
  }
  setPageStatus(pageId, 'active')
  return 'active'
}

export function buildMaterializePrompt(input: {
  siteId: string
  pageId: string
  entityKey: string
  company: string
  recordJson: string
}): string {
  return [
    `Materialize Personalised Internet entity page for ${input.company}.`,
    `siteId=${input.siteId}`,
    `pageId=${input.pageId}`,
    `entityKey=${input.entityKey}`,
    `Record JSON: ${input.recordJson}`,
    '',
    'Instructions:',
    '1. Load skills pi-page-dsl / pi-page-patch as needed.',
    '2. Use context_search / vault files for this company — do not invent facts.',
    '3. Replace the stub page body via pi_page_patch (replaceNodes or setTitle + nodes).',
    '4. Include title, role/stage summary, next actions, and useful links if known.',
    '5. Remove the "Preparing details…" note when done.',
    '6. Do not create a mega-page for other companies — only this entity.',
  ].join('\n')
}

/** Enqueue a scheduled_run that the extension drain will execute as an agent turn. */
export function enqueueMaterializeRun(input: {
  siteId: string
  pageId: string
  entityKey: string
  company: string
  recordJson: string
  bucketId?: string
}): string {
  const id = newPiId('run')
  const ts = Date.now()
  const prompt = buildMaterializePrompt(input)
  sqlite()
    .prepare(
      `INSERT INTO scheduled_runs
        (id, source, source_id, idempotency_key, prompt, bucket_id, status, completed_steps_json, created_at)
       VALUES (?, 'pi-materialize', ?, ?, ?, ?, 'pending', '[]', ?)`,
    )
    .run(
      id,
      input.siteId,
      `pi-materialize:${input.siteId}:${input.entityKey}:${input.pageId}`,
      prompt,
      input.bucketId ?? 'default',
      ts,
    )
  logger.info('pi materialize run enqueued', {
    runId: id,
    siteId: input.siteId,
    pageId: input.pageId,
    entityKey: input.entityKey,
  })
  return id
}

export async function ensureAndMaterialize(
  siteId: string,
  entityKey: string,
  options?: { materialize?: boolean },
): Promise<EnsureEntityPageResult & { runId?: string }> {
  const ensured = await ensureEntityPage(siteId, entityKey)
  const shouldMaterialize = options?.materialize !== false && ensured.stub
  if (!shouldMaterialize) return ensured

  const site = getSite(siteId)
  const rec = findRecordByEntityKey(siteId, entityKey)
  const record = rec ? parseRecordData(rec) : {}
  setPageStatus(ensured.pageId, 'refreshing')
  const runId = enqueueMaterializeRun({
    siteId,
    pageId: ensured.pageId,
    entityKey: decodeURIComponent(entityKey).trim(),
    company: ensured.company,
    recordJson: JSON.stringify(record),
    bucketId: site?.bucketId,
  })
  return { ...ensured, runId }
}
