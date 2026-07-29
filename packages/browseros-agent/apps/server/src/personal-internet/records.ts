/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Job-search (and generic) record helpers: normalize, sync board/chart from SoT.
 */

import type { PiRecordRow } from '../lib/db/schema/personal-internet'
import { applyPatchOps } from './dsl'
import { indexPiPage } from './index-pi'
import { entityRoute } from './paths'
import {
  getPage,
  getRecord,
  getSite,
  listPagesForSite,
  listRecords,
  readPageDoc,
  upsertRecord,
  writePageDoc,
} from './store'
import type { PiNode, PiPageDoc } from './types'

export const JOB_SEARCH_STAGES = [
  'applied',
  'interviewing',
  'offer',
  'ghosted',
  'rejected',
  'hold',
] as const

export type JobSearchStage = (typeof JOB_SEARCH_STAGES)[number]

export type NormalizedJobSearchRecord = {
  company: string
  role?: string
  stage: JobSearchStage
  url?: string
  nextAction?: string
  notes?: string
  entityKey: string
  pageId?: string
}

function slugifyEntityKey(company: string): string {
  const base = company
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'company'
}

export function isJobSearchStage(value: string): value is JobSearchStage {
  return (JOB_SEARCH_STAGES as readonly string[]).includes(value)
}

export function normalizeJobSearchRecord(
  data: Record<string, unknown>,
): NormalizedJobSearchRecord {
  const company = String(data.company ?? data.name ?? '').trim()
  if (!company) {
    throw new Error('job-application record requires company (or name)')
  }
  const rawStage = String(data.stage ?? data.status ?? 'applied')
    .toLowerCase()
    .trim()
  const stage: JobSearchStage = isJobSearchStage(rawStage)
    ? rawStage
    : 'applied'
  const entityKey =
    typeof data.entityKey === 'string' && data.entityKey.trim()
      ? data.entityKey.trim()
      : slugifyEntityKey(company)
  const role =
    typeof data.role === 'string' && data.role.trim()
      ? data.role.trim()
      : undefined
  const url =
    typeof data.url === 'string' && data.url.trim()
      ? data.url.trim()
      : undefined
  const nextAction =
    typeof data.nextAction === 'string' && data.nextAction.trim()
      ? data.nextAction.trim()
      : undefined
  const notes =
    typeof data.notes === 'string' && data.notes.trim()
      ? data.notes.trim()
      : undefined
  const pageId =
    typeof data.pageId === 'string' && data.pageId.trim()
      ? data.pageId.trim()
      : undefined

  return {
    company,
    role,
    stage,
    url,
    nextAction,
    notes,
    entityKey,
    pageId,
  }
}

export function parseRecordData(rec: PiRecordRow): Record<string, unknown> {
  try {
    return JSON.parse(rec.dataJson) as Record<string, unknown>
  } catch {
    return {}
  }
}

function findFirstBoard(
  nodes: PiNode[],
): Extract<PiNode, { type: 'board' }> | null {
  for (const n of nodes) {
    if (n.type === 'board') return n
    if (n.type === 'stack') {
      const inner = findFirstBoard(n.children)
      if (inner) return inner
    }
  }
  return null
}

function findFirstChart(
  nodes: PiNode[],
): Extract<PiNode, { type: 'chart' }> | null {
  for (const n of nodes) {
    if (n.type === 'chart') return n
    if (n.type === 'stack') {
      const inner = findFirstChart(n.children)
      if (inner) return inner
    }
  }
  return null
}

function findIndexPageId(siteId: string): string | null {
  const pages = listPagesForSite(siteId)
  return pages.find((p) => p.kind === 'index')?.id ?? pages[0]?.id ?? null
}

/** Rebuild index board cards/columns from site records (job-search shape). */
export async function syncBoardFromRecords(
  siteId: string,
  options?: { pageId?: string },
): Promise<{ pageId: string; cardCount: number } | null> {
  const site = getSite(siteId)
  if (!site) return null
  const pageId = options?.pageId ?? findIndexPageId(siteId)
  if (!pageId) return null
  const page = getPage(pageId)
  const doc = await readPageDoc(pageId)
  if (!page || !doc) return null

  const board = findFirstBoard(doc.nodes)
  if (!board) return null

  const records = listRecords(siteId)
  const columns = board.columns.map((c) => ({
    ...c,
    cardIds: [] as string[],
  }))
  const columnById = new Map(columns.map((c) => [c.id, c]))
  // Ensure job-search stages exist as columns when missing.
  for (const stage of JOB_SEARCH_STAGES) {
    if (!columnById.has(stage)) {
      const col = {
        id: stage,
        title: stage.charAt(0).toUpperCase() + stage.slice(1),
        cardIds: [] as string[],
      }
      columns.push(col)
      columnById.set(stage, col)
    }
  }

  const cards: Extract<PiNode, { type: 'board' }>['cards'] = []
  for (const rec of records) {
    const raw = parseRecordData(rec)
    let normalized: NormalizedJobSearchRecord
    try {
      normalized = normalizeJobSearchRecord(raw)
    } catch {
      continue
    }
    const cardId = `card_${rec.id}`
    const col = columnById.get(normalized.stage) ?? columnById.get('applied')
    if (!col) continue
    col.cardIds.push(cardId)
    const subtitleParts = [
      normalized.role,
      normalized.nextAction ? `Next: ${normalized.nextAction}` : undefined,
    ].filter(Boolean)
    cards.push({
      id: cardId,
      recordId: rec.id,
      title: normalized.company,
      subtitle: subtitleParts.length ? subtitleParts.join(' · ') : undefined,
      actions: [
        {
          label: 'Details',
          action: {
            kind: 'open-internal',
            route: entityRoute(siteId, normalized.entityKey),
          },
        },
        ...(normalized.nextAction
          ? [
              {
                label: 'Follow up',
                action: {
                  kind: 'agent' as const,
                  query: `Follow up for ${normalized.company}: ${normalized.nextAction}`,
                  metadata: {
                    siteId,
                    recordId: rec.id,
                    returnRoute: entityRoute(siteId, normalized.entityKey),
                  },
                },
              },
            ]
          : []),
      ],
    })
  }

  const nextBoard: Extract<PiNode, { type: 'board' }> = {
    type: 'board',
    columns,
    cards,
  }

  const replaceBoard = (nodes: PiNode[]): PiNode[] =>
    nodes.map((n) => {
      if (n.type === 'board') return nextBoard
      if (n.type === 'stack') {
        return { ...n, children: replaceBoard(n.children) }
      }
      return n
    })

  let nextDoc: PiPageDoc = {
    version: 1,
    title: doc.title,
    nodes: replaceBoard(doc.nodes),
  }
  nextDoc = applyPatchOps(doc, [{ op: 'replaceNodes', nodes: nextDoc.nodes }])

  await writePageDoc(page.siteId, page.id, nextDoc, {
    kind: page.kind,
    filePath: page.filePath,
  })
  if (page.siteId) {
    indexPiPage(page.id, page.bucketId, page.siteId, nextDoc.title, nextDoc)
  }
  return { pageId: page.id, cardCount: cards.length }
}

/** Rebuild first chart on the index page from stage counts (creates chart if absent). */
export async function syncChartFromRecords(
  siteId: string,
  options?: { pageId?: string },
): Promise<{ pageId: string } | null> {
  const pageId = options?.pageId ?? findIndexPageId(siteId)
  if (!pageId) return null
  const page = getPage(pageId)
  const doc = await readPageDoc(pageId)
  if (!page || !doc) return null

  const records = listRecords(siteId)
  const counts: Record<string, number> = {}
  for (const rec of records) {
    const raw = parseRecordData(rec)
    try {
      const n = normalizeJobSearchRecord(raw)
      counts[n.stage] = (counts[n.stage] ?? 0) + 1
    } catch {
      /* skip */
    }
  }
  const data: Array<{ label: string; value: number }> =
    JOB_SEARCH_STAGES.filter((s) => (counts[s] ?? 0) > 0).map((s) => ({
      label: s,
      value: counts[s]!,
    }))
  if (data.length === 0) {
    data.push({ label: 'empty', value: 0 })
  }

  const chartNode: Extract<PiNode, { type: 'chart' }> = {
    type: 'chart',
    chartType: 'bar',
    title: 'Pipeline by stage',
    data,
  }

  const existing = findFirstChart(doc.nodes)
  let nodes: PiNode[]
  if (existing) {
    const replaceChart = (ns: PiNode[]): PiNode[] =>
      ns.map((n) => {
        if (n.type === 'chart') return chartNode
        if (n.type === 'stack') {
          return { ...n, children: replaceChart(n.children) }
        }
        return n
      })
    nodes = replaceChart(doc.nodes)
  } else {
    nodes = [...doc.nodes, chartNode]
  }

  const nextDoc = applyPatchOps(doc, [{ op: 'replaceNodes', nodes }])
  await writePageDoc(page.siteId, page.id, nextDoc, {
    kind: page.kind,
    filePath: page.filePath,
  })
  if (page.siteId) {
    indexPiPage(page.id, page.bucketId, page.siteId, nextDoc.title, nextDoc)
  }
  return { pageId: page.id }
}

/** After drag/move: update bound record stage to column id. */
export function updateRecordStageFromCardMove(
  cardId: string,
  toColumnId: string,
): void {
  // Cards from sync use card_<recordId>; also try looking up by recordId on board is server-side.
  const recordId = cardId.startsWith('card_')
    ? cardId.slice('card_'.length)
    : null
  if (!recordId) return
  const rec = getRecord(recordId)
  if (!rec) return
  const raw = parseRecordData(rec)
  if (!isJobSearchStage(toColumnId) && typeof raw.stage !== 'string') {
    // Still write stage so pulse counts follow column.
  }
  const next = { ...raw, stage: toColumnId }
  try {
    const normalized = normalizeJobSearchRecord(next)
    upsertRecord({
      id: rec.id,
      siteId: rec.siteId,
      type: rec.type,
      data: { ...raw, ...normalized, stage: toColumnId },
    })
  } catch {
    upsertRecord({
      id: rec.id,
      siteId: rec.siteId,
      type: rec.type,
      data: next,
    })
  }
}

export function findRecordByEntityKey(
  siteId: string,
  entityKey: string,
): PiRecordRow | null {
  const key = entityKey.trim().toLowerCase()
  for (const rec of listRecords(siteId)) {
    const raw = parseRecordData(rec)
    try {
      const n = normalizeJobSearchRecord(raw)
      if (n.entityKey.toLowerCase() === key) return rec
    } catch {
      const company = String(raw.company ?? raw.name ?? '')
        .toLowerCase()
        .trim()
      if (slugifyEntityKey(company) === key) return rec
    }
  }
  return null
}
