/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Lazy entity pages: sync ATF + focused BTF materialize runs.
 */

import { getDbHandle } from '../lib/db'
import { logger } from '../lib/logger'
import {
  createRunRecord,
  findActiveMaterializeRunForPage,
  findRunByIdempotencyKey,
} from '../scheduler/run-executor'
import { BTF_LOADING_NOTE, buildEntityAtfDoc } from './atf'
import { acquirePiFocus, cancelMaterializeRun, setPiFocusRun } from './focus'
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
  readPageDoc,
  upsertRecord,
  writePageDoc,
} from './store'
import type { PiMaterializePhase, PiPageDoc } from './types'
import { applyPiMutation } from './write-path'

function sqlite() {
  return getDbHandle().sqlite
}

/** @deprecated Legacy stub heuristic — prefer meta.materialize.phase */
export function isEntityStubDoc(doc: PiPageDoc | null | undefined): boolean {
  if (!doc) return true
  if (doc.meta?.materialize?.phase === 'done') return false
  if (doc.meta?.materialize?.phase === 'atf') return false
  if (
    doc.meta?.materialize?.phase === 'btf-structure' ||
    doc.meta?.materialize?.phase === 'btf-filling'
  ) {
    return false
  }
  return doc.nodes.some(
    (n) => n.type === 'note' && n.text.includes('Preparing details'),
  )
}

export function isLegacyStubDoc(doc: PiPageDoc | null | undefined): boolean {
  if (!doc) return true
  if (doc.meta?.materialize) return false
  return doc.nodes.some(
    (n) => n.type === 'note' && n.text.includes('Preparing details'),
  )
}

export function getMaterializePhase(
  doc: PiPageDoc | null | undefined,
): PiMaterializePhase {
  if (!doc) return 'atf'
  if (doc.meta?.materialize?.phase) return doc.meta.materialize.phase
  if (isLegacyStubDoc(doc)) return 'atf'
  // Filled page without meta (pre-ATF agent rewrite) treat as done
  if (!isEntityStubDoc(doc) && !hasBtfLoadingMarker(doc)) return 'done'
  return 'atf'
}

function hasBtfLoadingMarker(doc: PiPageDoc): boolean {
  const walk = (nodes: PiPageDoc['nodes']): boolean => {
    for (const n of nodes) {
      if (n.type === 'note' && n.text.includes(BTF_LOADING_NOTE)) return true
      if (n.type === 'note' && n.text.includes('Preparing details')) return true
      if (n.type === 'stack' && walk(n.children)) return true
    }
    return false
  }
  return walk(doc.nodes)
}

export function isAtfReady(doc: PiPageDoc | null | undefined): boolean {
  if (!doc) return false
  if (isLegacyStubDoc(doc)) return false
  return Boolean(doc.meta?.materialize) || !isEntityStubDoc(doc)
}

export function isBtfComplete(doc: PiPageDoc | null | undefined): boolean {
  if (!doc) return false
  if (doc.meta?.materialize?.phase === 'done') return true
  if (doc.meta?.materialize) return false
  return !isLegacyStubDoc(doc) && !hasBtfLoadingMarker(doc)
}

/** @deprecated Use buildEntityAtfDoc */
export function buildEntityStubDoc(company: string): PiPageDoc {
  return buildEntityAtfDoc({
    company,
    entityKey: company.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'company',
    siteId: '_',
  })
}

export type EnsureEntityPageResult = {
  pageId: string
  route: string
  entityRoute: string
  entityKey: string
  created: boolean
  /** @deprecated use !atfReady / phase */
  stub: boolean
  atfReady: boolean
  btfComplete: boolean
  phase: PiMaterializePhase
  recordId: string | null
  company: string
  focusAcquired: boolean
  runId?: string
  conversationId?: string | null
}

async function findPageByEntityKeyMeta(
  siteId: string,
  key: string,
): Promise<{ pageId: string; doc: PiPageDoc } | null> {
  const pages = listPagesForSite(siteId).filter((p) => p.kind === 'entity')
  for (const p of pages) {
    const doc = await readPageDoc(p.id)
    if (doc?.meta?.entityKey?.toLowerCase() === key.toLowerCase()) {
      return { pageId: p.id, doc }
    }
  }
  return null
}

function atfInputFromRecord(
  siteId: string,
  key: string,
  company: string,
  data: Record<string, unknown>,
) {
  let role: string | undefined
  let stage: string | undefined
  let nextAction: string | undefined
  let url: string | undefined
  let notes: string | undefined
  try {
    const n = normalizeJobSearchRecord(data)
    role = n.role
    stage = n.stage
    nextAction = n.nextAction
    url = n.url
    notes = n.notes
  } catch {
    role = typeof data.role === 'string' ? data.role : undefined
    stage = typeof data.stage === 'string' ? data.stage : undefined
    nextAction =
      typeof data.nextAction === 'string' ? data.nextAction : undefined
    url = typeof data.url === 'string' ? data.url : undefined
    notes = typeof data.notes === 'string' ? data.notes : undefined
  }
  return {
    company,
    entityKey: key,
    siteId,
    role,
    stage,
    nextAction,
    url,
    notes,
  }
}

async function upgradeOrWriteAtf(
  siteId: string,
  pageId: string,
  atf: PiPageDoc,
): Promise<void> {
  await writePageDoc(siteId, pageId, atf, { kind: 'entity' })
  setPageStatus(pageId, 'refreshing')
}

function resultFromDoc(
  siteId: string,
  key: string,
  pageId: string,
  company: string,
  doc: PiPageDoc | null,
  created: boolean,
  recordId: string | null,
  extras?: Partial<EnsureEntityPageResult>,
): EnsureEntityPageResult {
  const phase = getMaterializePhase(doc)
  const atfReady = isAtfReady(doc)
  const btfComplete = isBtfComplete(doc)
  return {
    pageId,
    route: pageRoute(siteId, pageId),
    entityRoute: entityRoute(siteId, key),
    entityKey: key,
    created,
    stub: !atfReady,
    atfReady,
    btfComplete,
    phase,
    recordId,
    company,
    focusAcquired: false,
    ...extras,
  }
}

/** Find or create a durable entity page with sync ATF; bind pageId on record. */
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
  }

  const bindRecord = (pageId: string) => {
    if (!record) return
    upsertRecord({
      id: record.id,
      siteId,
      type: record.type,
      data: { ...data, pageId, entityKey: key },
    })
  }

  const finishExisting = async (
    pageId: string,
    created: boolean,
  ): Promise<EnsureEntityPageResult> => {
    let doc = await readPageDoc(pageId)
    const phase = getMaterializePhase(doc)
    const sectionsEmpty =
      !doc?.meta?.materialize?.sections ||
      doc.meta.materialize.sections.length === 0
    // Refresh sync ATF from record while still in ATF (no BTF sections yet).
    if (
      isLegacyStubDoc(doc) ||
      (doc && phase === 'atf' && sectionsEmpty && hasBtfLoadingMarker(doc))
    ) {
      const atf = buildEntityAtfDoc(
        atfInputFromRecord(siteId, key, company, data),
      )
      await upgradeOrWriteAtf(siteId, pageId, atf)
      doc = atf
    } else if (doc && !doc.meta?.entityKey) {
      await applyPiMutation({
        type: 'patch-page',
        pageId,
        ops: [
          {
            op: 'setMeta',
            meta: {
              ...(doc.meta ?? {}),
              entityKey: key,
              materialize: doc.meta?.materialize ?? {
                phase: isBtfComplete(doc) ? 'done' : 'atf',
                sections: doc.meta?.materialize?.sections ?? [],
              },
            },
          },
        ],
      })
      doc = await readPageDoc(pageId)
    }
    bindRecord(pageId)
    return resultFromDoc(
      siteId,
      key,
      pageId,
      company,
      doc,
      created,
      record?.id ?? null,
    )
  }

  if (record && typeof data.pageId === 'string' && data.pageId) {
    const existing = getPage(data.pageId)
    if (existing && existing.siteId === siteId) {
      return finishExisting(existing.id, false)
    }
  }

  const byMeta = await findPageByEntityKeyMeta(siteId, key)
  if (byMeta) {
    return finishExisting(byMeta.pageId, false)
  }

  // Exact binding only: record.pageId → meta.entityKey. Never title equality.
  const atf = buildEntityAtfDoc(atfInputFromRecord(siteId, key, company, data))
  const created = await applyPiMutation({
    type: 'create-page',
    mode: 'durable',
    siteId,
    title: company,
    doc: atf,
    kind: 'entity',
  })
  if (!created.pageId) throw new Error('failed to create entity page')
  bindRecord(created.pageId)
  setPageStatus(created.pageId, 'refreshing')
  return resultFromDoc(
    siteId,
    key,
    created.pageId,
    company,
    atf,
    true,
    record?.id ?? null,
  )
}

export function setPageStatus(pageId: string, status: string): void {
  const page = getPage(pageId)
  if (!page) return
  sqlite()
    .prepare(`UPDATE pi_pages SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, Date.now(), pageId)
}

export async function finalizeMaterializePageStatus(
  pageId: string,
  runOk: boolean,
): Promise<'active' | 'refreshing' | 'error-stale'> {
  const doc = await readPageDoc(pageId)
  if (!runOk) {
    setPageStatus(pageId, 'error-stale')
    return 'error-stale'
  }
  if (isBtfComplete(doc) || doc?.meta?.materialize?.phase === 'done') {
    setPageStatus(pageId, 'active')
    return 'active'
  }
  if (isLegacyStubDoc(doc)) {
    setPageStatus(pageId, 'refreshing')
    return 'refreshing'
  }
  // ATF or partial BTF still enriching
  if (!isBtfComplete(doc)) {
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
  phase: PiMaterializePhase
  filledSections: string[]
}): string {
  return [
    `Continue Personalised Internet entity BTF.`,
    `siteId=${input.siteId}`,
    `pageId=${input.pageId}`,
    `entityKey=${input.entityKey}`,
    `company=${input.company}`,
    `phase=${input.phase}`,
    `filledSections=${input.filledSections.join(',') || '(none)'}`,
    `Load skill pi-entity-materialize, then pi_page_patch only this pageId.`,
  ].join('\n')
}

function isActiveRunStatus(status: string): boolean {
  return (
    status === 'pending' ||
    status === 'running' ||
    status === 'awaiting-approval'
  )
}

export function enqueueMaterializeRun(input: {
  siteId: string
  pageId: string
  entityKey: string
  company: string
  phase: PiMaterializePhase
  filledSections: string[]
  bucketId?: string
  force?: boolean
}): string {
  const baseKey = `pi-materialize:${input.siteId}:${input.entityKey}:${input.pageId}`
  const prompt = buildMaterializePrompt(input)

  const active = findActiveMaterializeRunForPage(input.pageId)
  if (active && !input.force) {
    return active.id
  }
  if (active && input.force) {
    cancelMaterializeRun(active.id, 'force-retry')
  }

  const existing = findRunByIdempotencyKey(baseKey)
  const idempotencyKey =
    (existing && !isActiveRunStatus(existing.status)) || input.force
      ? `${baseKey}:r${Date.now()}`
      : baseKey

  const record = createRunRecord({
    source: 'pi-materialize',
    sourceId: input.pageId,
    idempotencyKey,
    prompt,
    bucketId: input.bucketId ?? 'default',
  })
  logger.info('pi materialize run enqueued', {
    runId: record.id,
    siteId: input.siteId,
    pageId: input.pageId,
    entityKey: input.entityKey,
    force: Boolean(input.force),
  })
  return record.id
}

export async function ensureAndMaterialize(
  siteId: string,
  entityKey: string,
  options?: { materialize?: boolean; force?: boolean },
): Promise<EnsureEntityPageResult> {
  const ensured = await ensureEntityPage(siteId, entityKey)
  const key = decodeURIComponent(entityKey).trim()

  const doc = await readPageDoc(ensured.pageId)
  const btfComplete = isBtfComplete(doc)
  // Only user/UI deepen (materialize:true) takes the focus lease. Cheap ATF
  // ensure (default false) must not cancel an in-flight sibling BTF.
  const wantFocus = options?.materialize === true
  const shouldMaterialize =
    wantFocus && (!btfComplete || options.force === true)

  let focusAcquired = false
  if (wantFocus) {
    acquirePiFocus({
      siteId,
      pageId: ensured.pageId,
      entityKey: key,
    })
    focusAcquired = true
  }

  let runId: string | undefined
  let conversationId: string | null | undefined

  if (shouldMaterialize) {
    const site = getSite(siteId)
    const filledSections =
      doc?.meta?.materialize?.sections
        .filter((s) => s.status === 'filled' || s.status === 'skipped')
        .map((s) => s.id) ?? []
    setPageStatus(ensured.pageId, 'refreshing')
    runId = enqueueMaterializeRun({
      siteId,
      pageId: ensured.pageId,
      entityKey: key,
      company: ensured.company,
      phase: getMaterializePhase(doc),
      filledSections,
      bucketId: site?.bucketId,
      force: options?.force,
    })
    setPiFocusRun(runId)
    const active = findActiveMaterializeRunForPage(ensured.pageId)
    conversationId = active?.conversationId ?? null
  }

  return {
    ...ensured,
    focusAcquired,
    btfComplete: btfComplete && !options?.force,
    runId,
    conversationId,
  }
}
