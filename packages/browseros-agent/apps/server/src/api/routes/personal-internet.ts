/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { validatePageDoc } from '../../personal-internet/dsl'
import { getLastPiMutationAt } from '../../personal-internet/events'
import { releasePiFocus } from '../../personal-internet/focus'
import { ensureAndMaterialize } from '../../personal-internet/materialize'
import {
  handleHostOpened,
  handleRefreshTrigger,
} from '../../personal-internet/refresh/bus'
import { drainRefreshJobs } from '../../personal-internet/refresh/runner'
import {
  deleteTemp,
  getPage,
  getPulse,
  getSite,
  getTemp,
  hardDeleteSite,
  listPagesForSite,
  listRecords,
  listSites,
  listTemps,
  readHomePrefs,
  readPageDoc,
  touchSite,
  upsertSite,
  writeHomePrefs,
} from '../../personal-internet/store'
import type {
  PiPageDoc,
  PiPatchOp,
  PiTemplateId,
} from '../../personal-internet/types'
import {
  applyPiMutation,
  preserveTemp,
} from '../../personal-internet/write-path'
import type { Env } from '../types'

const UpsertSiteSchema = z.object({
  templateId: z.enum(['job-search', 'research-hub', 'sales-leads']).optional(),
  name: z.string().optional(),
  slug: z.string().optional(),
  jtbd: z.string().optional(),
  harvestEnabled: z.boolean().optional(),
})

const CreatePageSchema = z.object({
  mode: z.enum(['durable', 'temp']),
  siteId: z.string().optional(),
  title: z.string().min(1),
  doc: z.unknown(),
  kind: z.string().optional(),
  ttlMs: z.number().optional(),
})

const PatchPageSchema = z.object({
  ops: z.array(z.record(z.unknown())).min(1),
})

const PreserveSchema = z.object({
  mode: z.enum(['attach', 'new_site', 'standalone']),
  siteId: z.string().optional(),
  title: z.string().optional(),
  templateId: z.enum(['job-search', 'research-hub', 'sales-leads']).optional(),
})

const ActionSchema = z.object({
  kind: z.enum(['open-internal', 'open-external', 'local', 'agent']),
  route: z.string().optional(),
  url: z.string().optional(),
  op: z.enum(['filter', 'expand', 'copy', 'dismiss']).optional(),
  args: z.record(z.unknown()).optional(),
  query: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  siteId: z.string().optional(),
  pageId: z.string().optional(),
})

const HostOpenedSchema = z.object({
  host: z.string().min(1),
})

export function createPersonalInternetRoutes() {
  return new Hono<Env>()
    .get('/sites', (c) => {
      const status = c.req.query('status')
      const sites = listSites(
        status
          ? { status: status.split(',') as never }
          : { status: ['active', 'dormant', 'drafting'] },
      ).map((s) => ({
        ...s,
        pulse: getPulse(s.id),
      }))
      return c.json({ sites })
    })
    .post('/sites', async (c) => {
      const body = UpsertSiteSchema.parse(await c.req.json())
      const result = await applyPiMutation({
        type: 'upsert-site',
        templateId: body.templateId as PiTemplateId | undefined,
        name: body.name,
        slug: body.slug,
        jtbd: body.jtbd,
        harvestEnabled: body.harvestEnabled,
      })
      return c.json(result, 201)
    })
    .get('/sites/:siteId', async (c) => {
      const siteId = c.req.param('siteId')
      const site = getSite(siteId)
      if (!site) return c.json({ error: 'not found' }, 404)
      touchSite(siteId)
      const pages = await Promise.all(
        listPagesForSite(siteId).map(async (p) => {
          if (p.kind !== 'entity')
            return { ...p, entityKey: null as string | null }
          const doc = await readPageDoc(p.id)
          return {
            ...p,
            entityKey: doc?.meta?.entityKey ?? null,
          }
        }),
      )
      return c.json({
        site,
        pulse: getPulse(siteId),
        pages,
      })
    })
    .get('/sites/:siteId/records', (c) => {
      const siteId = c.req.param('siteId')
      if (!getSite(siteId)) return c.json({ error: 'not found' }, 404)
      const records = listRecords(siteId).map((r) => {
        let data: Record<string, unknown> = {}
        try {
          data = JSON.parse(r.dataJson) as Record<string, unknown>
        } catch {
          data = {}
        }
        return {
          id: r.id,
          type: r.type,
          version: r.version,
          updatedAt: r.updatedAt,
          data,
        }
      })
      return c.json({ records })
    })
    .post('/sites/:siteId/entities/:entityKey/ensure', async (c) => {
      const siteId = c.req.param('siteId')
      const entityKey = c.req.param('entityKey')
      const body = z
        .object({
          materialize: z.boolean().optional(),
          force: z.boolean().optional(),
        })
        .parse((await c.req.json().catch(() => ({}))) as unknown)
      if (!getSite(siteId)) return c.json({ error: 'not found' }, 404)
      try {
        const result = await ensureAndMaterialize(siteId, entityKey, {
          // Entity UI passes materialize:true; tools default false via omit.
          materialize: body.materialize,
          force: body.force,
        })
        return c.json(result)
      } catch (e) {
        return c.json({ error: String(e) }, 400)
      }
    })
    .delete('/focus', (c) => {
      const siteId = c.req.query('siteId') || undefined
      const pageId = c.req.query('pageId') || undefined
      const prev = releasePiFocus({ siteId, pageId })
      return c.json({ ok: true, released: Boolean(prev) })
    })
    .post('/sites/:siteId/doorway', async (c) => {
      const siteId = c.req.param('siteId')
      const site = getSite(siteId)
      if (!site) return c.json({ error: 'not found' }, 404)
      const body = z
        .object({
          eligible: z.boolean(),
          pin: z.boolean().optional(),
        })
        .parse(await c.req.json())
      await upsertSite({
        id: site.id,
        name: site.name,
        slug: site.slug,
        jtbd: site.jtbd,
        templateId: site.templateId,
        doorwayEligible: body.eligible,
        status: site.status as never,
      })
      if (body.pin) {
        const prefs = await readHomePrefs()
        const pinned = new Set(prefs.pinnedSiteIds)
        pinned.add(siteId)
        await writeHomePrefs({
          ...prefs,
          pinnedSiteIds: [...pinned],
        })
      }
      return c.json({
        siteId,
        doorwayEligible: body.eligible,
        pinned: !!body.pin,
        route: `#/pi/sites/${siteId}`,
      })
    })
    .get('/mutation-cursor', (c) => {
      return c.json({ lastMutationAt: getLastPiMutationAt() })
    })
    .post('/sites/:siteId/archive', async (c) => {
      const siteId = c.req.param('siteId')
      if (!getSite(siteId)) return c.json({ error: 'not found' }, 404)
      const result = await applyPiMutation({ type: 'archive-site', siteId })
      return c.json(result)
    })
    .delete('/sites/:siteId', async (c) => {
      const siteId = c.req.param('siteId')
      if (c.req.query('confirm') !== '1') {
        return c.json({ error: 'confirm=1 required' }, 400)
      }
      if (!getSite(siteId)) return c.json({ error: 'not found' }, 404)
      await hardDeleteSite(siteId)
      return c.json({ deleted: true, siteId })
    })
    .get('/sites/:siteId/pages/:pageId', async (c) => {
      const { siteId, pageId } = c.req.param()
      const page = getPage(pageId)
      if (!page || (page.siteId && page.siteId !== siteId)) {
        return c.json({ error: 'not found' }, 404)
      }
      const doc = await readPageDoc(pageId)
      return c.json({ page, doc, siteId })
    })
    .post('/pages', async (c) => {
      const body = CreatePageSchema.parse(await c.req.json())
      const doc = validatePageDoc(body.doc) as PiPageDoc
      const result = await applyPiMutation({
        type: 'create-page',
        mode: body.mode,
        siteId: body.siteId,
        title: body.title,
        doc,
        kind: body.kind,
        ttlMs: body.ttlMs,
      })
      return c.json(result, 201)
    })
    .patch('/pages/:pageId', async (c) => {
      const pageId = c.req.param('pageId')
      const body = PatchPageSchema.parse(await c.req.json())
      try {
        const result = await applyPiMutation({
          type: 'patch-page',
          pageId,
          ops: body.ops as PiPatchOp[],
        })
        return c.json(result)
      } catch (e) {
        return c.json({ error: String(e) }, 400)
      }
    })
    .delete('/pages/:pageId', async (c) => {
      if (c.req.query('confirm') !== '1') {
        return c.json({ error: 'confirm=1 required' }, 400)
      }
      const pageId = c.req.param('pageId')
      if (!getPage(pageId)) return c.json({ error: 'not found' }, 404)
      try {
        const result = await applyPiMutation({ type: 'delete-page', pageId })
        return c.json({ deleted: true, ...result })
      } catch (e) {
        return c.json({ error: String(e) }, 400)
      }
    })
    .get('/temps/:tempId', async (c) => {
      const tempId = c.req.param('tempId')
      const temp = getTemp(tempId)
      if (!temp) return c.json({ error: 'not found' }, 404)
      const doc = await readPageDoc(tempId)
      return c.json({ temp, doc })
    })
    .delete('/temps/:tempId', async (c) => {
      const tempId = c.req.param('tempId')
      if (!getTemp(tempId)) return c.json({ error: 'not found' }, 404)
      await deleteTemp(tempId)
      return c.json({ deleted: true, tempId })
    })
    .post('/temps/:tempId/preserve', async (c) => {
      const tempId = c.req.param('tempId')
      const body = PreserveSchema.parse(await c.req.json())
      try {
        const result = await preserveTemp({
          tempId,
          mode: body.mode,
          siteId: body.siteId,
          title: body.title,
          templateId: body.templateId as PiTemplateId | undefined,
        })
        return c.json(result)
      } catch (e) {
        return c.json({ error: String(e) }, 400)
      }
    })
    .get('/library', (c) => {
      const sites = listSites({
        status: ['active', 'dormant', 'drafting', 'archived'],
      }).map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        status: s.status,
        templateId: s.templateId,
        doorwayEligible: !!s.doorwayEligible,
        harvestEnabled: !!s.harvestEnabled,
        harvestHost: s.harvestHost,
        pulseLine: getPulse(s.id)?.pulseLine ?? null,
        route: `#/pi/sites/${s.id}`,
        updatedAt: s.updatedAt,
      }))
      const temps = listTemps().map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        expiresAt: t.expiresAt,
        route: `#/pi/temp/${t.id}`,
      }))
      return c.json({ sites, temps })
    })
    .post('/actions/invoke', async (c) => {
      const body = ActionSchema.parse(await c.req.json())
      if (body.kind === 'agent') {
        return c.json({
          mode: 'agent',
          runHint: {
            query: body.query ?? '',
            metadata: {
              ...(body.metadata ?? {}),
              siteId: body.siteId,
              pageId: body.pageId,
            },
          },
        })
      }
      if (body.kind === 'open-internal') {
        return c.json({ mode: 'navigate', route: body.route })
      }
      if (body.kind === 'open-external') {
        return c.json({ mode: 'open-url', url: body.url })
      }
      // local — client-side; acknowledge
      return c.json({ mode: 'local', op: body.op, args: body.args ?? {} })
    })
    .post('/refresh', async (c) => {
      const body = z
        .object({
          siteId: z.string().optional(),
          trigger: z.string().optional(),
        })
        .parse((await c.req.json().catch(() => ({}))) as unknown)
      const jobs = handleRefreshTrigger({
        trigger: body.trigger ?? 'manual-refresh',
        siteId: body.siteId,
      })
      await drainRefreshJobs(10)
      return c.json({ enqueued: jobs.length, jobIds: jobs.map((j) => j.id) })
    })
    .post('/hooks/host-opened', async (c) => {
      const body = HostOpenedSchema.parse(await c.req.json())
      const jobs = handleHostOpened(body.host)
      if (jobs.length > 0) await drainRefreshJobs(5)
      return c.json({
        enqueued: jobs.length,
        jobIds: jobs.map((j) => j.id),
      })
    })
}
