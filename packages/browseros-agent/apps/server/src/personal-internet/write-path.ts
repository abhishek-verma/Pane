/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { applyPatchOps, validatePageDoc } from './dsl'
import { emitPiEvent } from './events'
import {
  buildHarvestPolicy,
  harvestConfigFromSite,
  proposeHarvestConfig,
} from './harvest-config'
import { indexPiPage, indexPiRecord, removePiSiteIndex } from './index-pi'
import { pageRoute, siteRoute, tempRoute } from './paths'
import { shouldAutoDoorway } from './promote'
import { recomputePulse } from './pulse'
import {
  normalizeJobSearchRecord,
  syncBoardFromRecords,
  syncChartFromRecords,
  updateRecordStageFromCardMove,
} from './records'
import {
  archiveSite,
  createTemp,
  deletePage,
  getPage,
  getSite,
  getSiteBySlug,
  getTemp,
  inspectPageDoc,
  listPagesForSite,
  newPiId,
  readPageDoc,
  upsertPolicy,
  upsertRecord,
  upsertSite,
  writePageDoc,
} from './store'
import { getSiteTemplate } from './templates'
import type { PiPageDoc, PiPatchOp, PiTemplateId, PreserveMode } from './types'

export type ApplyPiMutationInput =
  | {
      type: 'upsert-site'
      templateId?: PiTemplateId
      name?: string
      slug?: string
      jtbd?: string
      harvestEnabled?: boolean
      harvestSources?: string[]
      harvestCadenceDays?: number
      harvestInstructions?: string
      harvestFromMeetings?: boolean
      harvestOnHostOpened?: boolean
      harvestAllowNavigate?: boolean
    }
  | {
      type: 'patch-page'
      pageId: string
      ops: PiPatchOp[]
    }
  | {
      type: 'create-page'
      mode: 'durable' | 'temp'
      siteId?: string
      title: string
      doc: PiPageDoc
      kind?: string
      ttlMs?: number
    }
  | {
      type: 'upsert-record'
      siteId: string
      recordId?: string
      recordType: string
      data: Record<string, unknown>
      expectedVersion?: number
      pageId?: string
      pageOps?: PiPatchOp[]
      /** Rebuild index board/chart from records (default true for job-application). */
      syncBoard?: boolean
    }
  | {
      type: 'archive-site'
      siteId: string
    }
  | {
      type: 'delete-page'
      pageId: string
    }

export type ApplyPiMutationResult = {
  siteId?: string
  pageId?: string
  recordId?: string
  route?: string
  pulseLine?: string
  created?: boolean
  harvestOffer?: ReturnType<typeof proposeHarvestConfig> & {
    requiresUserConfirmation: true
    message: string
  }
  harvestConfig?: ReturnType<typeof harvestConfigFromSite>
}

/** Optional hook so refresh bus can enqueue without circular imports. */
let afterMutationHook: ((siteId?: string) => void) | null = null

export function setAfterMutationHook(
  hook: ((siteId?: string) => void) | null,
): void {
  afterMutationHook = hook
}

export async function applyPiMutation(
  input: ApplyPiMutationInput,
): Promise<ApplyPiMutationResult> {
  switch (input.type) {
    case 'upsert-site': {
      const template = input.templateId
        ? getSiteTemplate(input.templateId)
        : null
      const slug = input.slug ?? template?.slug ?? 'site'
      const existing = getSiteBySlug(slug)
      const created = !existing
      const site = await upsertSite({
        id: existing?.id,
        name: input.name ?? template?.name ?? existing?.name ?? 'Personal site',
        slug,
        jtbd: input.jtbd ?? template?.jtbd ?? existing?.jtbd ?? '',
        templateId: input.templateId ?? existing?.templateId,
        ...(input.harvestEnabled !== undefined
          ? { harvestEnabled: input.harvestEnabled }
          : {}),
        ...(input.harvestSources !== undefined
          ? { harvestSources: input.harvestSources }
          : created
            ? { harvestSources: [] }
            : {}),
        ...(input.harvestCadenceDays !== undefined
          ? { harvestCadenceDays: input.harvestCadenceDays }
          : {}),
        ...(input.harvestInstructions !== undefined
          ? { harvestInstructions: input.harvestInstructions }
          : {}),
        ...(input.harvestFromMeetings !== undefined
          ? { harvestFromMeetings: input.harvestFromMeetings }
          : {}),
        ...(input.harvestOnHostOpened !== undefined
          ? { harvestOnHostOpened: input.harvestOnHostOpened }
          : {}),
        ...(input.harvestAllowNavigate !== undefined
          ? { harvestAllowNavigate: input.harvestAllowNavigate }
          : {}),
        doorwayEligible: shouldAutoDoorway(
          input.templateId ?? existing?.templateId,
        ),
        status: 'active',
      })

      const harvestConfig = harvestConfigFromSite(site)
      const harvestTouched =
        input.harvestEnabled !== undefined ||
        input.harvestSources !== undefined ||
        input.harvestCadenceDays !== undefined ||
        input.harvestInstructions !== undefined ||
        input.harvestFromMeetings !== undefined ||
        input.harvestOnHostOpened !== undefined ||
        input.harvestAllowNavigate !== undefined

      if (created && template) {
        upsertPolicy('site', site.id, template.policy)
      }
      if (harvestTouched || created) {
        upsertPolicy('site', site.id, buildHarvestPolicy(harvestConfig))
      }

      let indexPage = listPagesForSite(site.id).find((p) => p.kind === 'index')
      if (!indexPage && template) {
        const pageId = newPiId('page')
        const newPage = await writePageDoc(site.id, pageId, template.indexDoc, {
          kind: 'index',
        })
        indexPiPage(
          pageId,
          newPage.bucketId,
          site.id,
          template.indexDoc.title,
          template.indexDoc,
        )
        indexPage = getPage(pageId) ?? undefined
      }

      const pulse = recomputePulse(site.id)
      emitPiEvent(created ? 'site-created' : 'site-updated', {
        siteId: site.id,
        pageId: indexPage?.id,
      })
      afterMutationHook?.(site.id)

      const offer = proposeHarvestConfig({
        name: site.name,
        jtbd: site.jtbd,
        templateId: site.templateId,
      })

      return {
        siteId: site.id,
        pageId: indexPage?.id,
        route: siteRoute(site.id),
        pulseLine: pulse?.pulseLine,
        created,
        harvestConfig,
        ...(created
          ? {
              harvestOffer: {
                ...offer,
                requiresUserConfirmation: true as const,
                message:
                  'Propose this harvest config (fill sources from conversation provenance). Do not enable until the user accepts or revises it.',
              },
            }
          : {}),
      }
    }

    case 'create-page': {
      validatePageDoc(input.doc)
      if (input.mode === 'temp') {
        const temp = await createTemp({
          title: input.title,
          doc: { ...input.doc, title: input.title },
          ttlMs: input.ttlMs,
        })
        return {
          pageId: temp.id,
          route: tempRoute(temp.id),
        }
      }
      if (!input.siteId) {
        throw new Error('durable page requires siteId')
      }
      const site = getSite(input.siteId)
      if (!site || site.status === 'archived') {
        throw new Error('site not found or archived')
      }
      const pageId = newPiId('page')
      const pageRow = await writePageDoc(input.siteId, pageId, input.doc, {
        kind: input.kind ?? 'entity',
      })
      indexPiPage(
        pageId,
        pageRow.bucketId,
        input.siteId,
        input.doc.title,
        input.doc,
      )
      recomputePulse(input.siteId)
      emitPiEvent('entity-mutated', { siteId: input.siteId, pageId })
      emitPiEvent('site-updated', { siteId: input.siteId, pageId })
      afterMutationHook?.(input.siteId)
      return {
        siteId: input.siteId,
        pageId,
        route: pageRoute(input.siteId, pageId),
      }
    }

    case 'patch-page': {
      const page = getPage(input.pageId)
      if (!page) throw new Error(`page not found: ${input.pageId}`)
      let doc = await readPageDoc(input.pageId)
      let repairedFromCorrupt = false
      if (!doc) {
        const inspection = await inspectPageDoc(input.pageId)
        const hasReplace = input.ops.some((op) => op.op === 'replaceNodes')
        if (!hasReplace) {
          throw new Error(
            `page doc corrupt or missing: ${input.pageId}. ` +
              `Call pi_read for raw+issues, then pi_page_patch with replaceNodes ` +
              `containing a full valid doc. Issues: ${(inspection?.issues ?? []).join('; ') || 'unreadable'}`,
          )
        }
        // Allow a full replaceNodes overwrite of a broken page.
        const rawTitle =
          inspection?.raw &&
          typeof inspection.raw === 'object' &&
          inspection.raw !== null &&
          typeof (inspection.raw as { title?: unknown }).title === 'string'
            ? (inspection.raw as { title: string }).title
            : page.title
        doc = {
          version: 1,
          title: rawTitle || page.title || 'Page',
          nodes: [],
        }
        repairedFromCorrupt = true
      }

      // bindRecord ops update SQLite records; remaining ops patch the doc.
      const bindOps = input.ops.filter((op) => op.op === 'bindRecord')
      const docOps = input.ops.filter((op) => op.op !== 'bindRecord')
      for (const op of bindOps) {
        if (op.op !== 'bindRecord') continue
        if (!page.siteId) {
          throw new Error('bindRecord requires a durable (site-attached) page')
        }
        const record = upsertRecord({
          id: op.recordId,
          siteId: page.siteId,
          type: 'bound',
          data: op.data,
        })
        indexPiRecord(record.id, page.siteId, record.bucketId, 'bound', op.data)
      }

      for (const op of docOps) {
        if (op.op === 'moveBoardCard') {
          updateRecordStageFromCardMove(op.cardId, op.toColumnId)
        }
      }

      const next =
        docOps.length > 0 ? applyPatchOps(doc, docOps) : validatePageDoc(doc)
      await writePageDoc(page.siteId, page.id, next, {
        kind: page.kind,
        filePath: page.filePath,
      })
      // Re-index the updated doc only for durable (site-attached) pages.
      if (page.siteId) {
        indexPiPage(page.id, page.bucketId, page.siteId, next.title, next)
        recomputePulse(page.siteId)
        emitPiEvent('entity-mutated', {
          siteId: page.siteId,
          pageId: page.id,
        })
        emitPiEvent('site-updated', { siteId: page.siteId, pageId: page.id })
        afterMutationHook?.(page.siteId)
      }
      return {
        siteId: page.siteId ?? undefined,
        pageId: page.id,
        route: page.siteId
          ? pageRoute(page.siteId, page.id)
          : tempRoute(page.id),
        ...(repairedFromCorrupt ? { repairedFromCorrupt: true } : {}),
      }
    }

    case 'upsert-record': {
      const site = getSite(input.siteId)
      if (!site || site.status === 'archived') {
        throw new Error('site not found or archived')
      }
      const recordType = input.recordType
      let data = input.data
      if (
        recordType === 'job-application' ||
        site.templateId === 'job-search'
      ) {
        const normalized = normalizeJobSearchRecord(data)
        data = { ...data, ...normalized }
      }
      const record = upsertRecord({
        id: input.recordId,
        siteId: input.siteId,
        type: recordType,
        data,
        expectedVersion: input.expectedVersion,
      })
      indexPiRecord(record.id, input.siteId, record.bucketId, recordType, data)
      if (input.pageId && input.pageOps?.length) {
        const page = getPage(input.pageId)
        const doc = page ? await readPageDoc(input.pageId) : null
        if (page && doc) {
          const next = applyPatchOps(doc, input.pageOps)
          await writePageDoc(page.siteId, page.id, next, {
            kind: page.kind,
            filePath: page.filePath,
          })
          if (page.siteId) {
            indexPiPage(page.id, page.bucketId, page.siteId, next.title, next)
          }
        }
      }
      const shouldSync =
        input.syncBoard !== false &&
        (recordType === 'job-application' || site.templateId === 'job-search')
      if (shouldSync) {
        await syncBoardFromRecords(input.siteId)
        await syncChartFromRecords(input.siteId)
      }
      const pulse = recomputePulse(input.siteId)
      emitPiEvent('entity-mutated', {
        siteId: input.siteId,
        recordId: record.id,
        pageId: input.pageId,
      })
      emitPiEvent('site-updated', { siteId: input.siteId })
      afterMutationHook?.(input.siteId)
      return {
        siteId: input.siteId,
        recordId: record.id,
        pageId: input.pageId,
        route: siteRoute(input.siteId),
        pulseLine: pulse?.pulseLine,
      }
    }

    case 'archive-site': {
      removePiSiteIndex(input.siteId)
      archiveSite(input.siteId)
      emitPiEvent('site-archived', { siteId: input.siteId })
      afterMutationHook?.(input.siteId)
      return { siteId: input.siteId }
    }

    case 'delete-page': {
      const page = getPage(input.pageId)
      if (!page) throw new Error(`page not found: ${input.pageId}`)
      const siteId = page.siteId ?? undefined
      await deletePage(input.pageId)
      if (siteId) {
        recomputePulse(siteId)
        emitPiEvent('entity-mutated', { siteId, pageId: input.pageId })
        emitPiEvent('site-updated', { siteId })
        afterMutationHook?.(siteId)
      }
      return { siteId, pageId: input.pageId }
    }
  }
}

export async function preserveTemp(input: {
  tempId: string
  mode: PreserveMode
  siteId?: string
  title?: string
  templateId?: PiTemplateId
}): Promise<ApplyPiMutationResult> {
  const temp = getTemp(input.tempId)
  if (!temp || temp.status !== 'active') {
    throw new Error(`temp not found: ${input.tempId}`)
  }
  const doc = await readPageDoc(input.tempId)
  if (!doc) throw new Error('temp page doc missing')

  if (input.mode === 'attach') {
    if (!input.siteId) throw new Error('attach requires siteId')
    const result = await applyPiMutation({
      type: 'create-page',
      mode: 'durable',
      siteId: input.siteId,
      title: input.title ?? temp.title,
      doc: { ...doc, title: input.title ?? temp.title },
      kind: 'entity',
    })
    const { deleteTemp } = await import('./store')
    await deleteTemp(input.tempId)
    return result
  }

  if (input.mode === 'new_site') {
    const siteResult = await applyPiMutation({
      type: 'upsert-site',
      templateId: input.templateId,
      name: input.title ?? temp.title,
    })
    if (!siteResult.siteId) throw new Error('failed to create site')
    const pageResult = await applyPiMutation({
      type: 'create-page',
      mode: 'durable',
      siteId: siteResult.siteId,
      title: input.title ?? temp.title,
      doc: { ...doc, title: input.title ?? temp.title },
      kind: 'entity',
    })
    const { deleteTemp } = await import('./store')
    await deleteTemp(input.tempId)
    return {
      siteId: siteResult.siteId,
      pageId: pageResult.pageId,
      route: pageResult.route ?? siteResult.route,
    }
  }

  // standalone: create a light site with this page as index-like entity
  const siteResult = await applyPiMutation({
    type: 'upsert-site',
    name: input.title ?? temp.title,
    slug: `page-${input.tempId.slice(-8)}`,
    jtbd: 'Standalone preserved page',
  })
  if (!siteResult.siteId) throw new Error('failed to create standalone site')
  const pageResult = await applyPiMutation({
    type: 'create-page',
    mode: 'durable',
    siteId: siteResult.siteId,
    title: input.title ?? temp.title,
    doc: { ...doc, title: input.title ?? temp.title },
    kind: 'entity',
  })
  // standalone sites are not auto-doorway unless user pins
  const { upsertSite: upsert } = await import('./store')
  await upsert({
    id: siteResult.siteId,
    name: input.title ?? temp.title,
    slug: `page-${input.tempId.slice(-8)}`,
    doorwayEligible: false,
  })
  const { deleteTemp } = await import('./store')
  await deleteTemp(input.tempId)
  return {
    siteId: siteResult.siteId,
    pageId: pageResult.pageId,
    route: pageResult.route,
  }
}
