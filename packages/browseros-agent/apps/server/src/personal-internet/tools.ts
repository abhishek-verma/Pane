/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Agent tools for Personalised Internet. All mutations go through write-path.
 */

import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { validatePageDoc } from './dsl'
import {
  getPage,
  getPulse,
  getSite,
  getTemp,
  listPagesForSite,
  listSites,
  listTemps,
  readHomePrefs,
  readHomeRegions,
  readPageDoc,
  writeHomeContinuity,
  writeHomePrefs,
} from './store'
import type {
  PiContinuityBlock,
  PiPageDoc,
  PiPatchOp,
  PiTemplateId,
} from './types'
import { applyPiMutation, preserveTemp } from './write-path'

const templateIdSchema = z.enum(['job-search', 'research-hub', 'sales-leads'])

const pageDocSchema = z
  .object({
    version: z.literal(1),
    title: z.string(),
    nodes: z.array(z.unknown()),
  })
  .passthrough()

function ok(data: Record<string, unknown>) {
  return { text: JSON.stringify(data) }
}

function err(message: string) {
  return { text: message, isError: true as const }
}

export function buildPersonalInternetToolSet(
  _getBucketId?: () => string,
): ToolSet {
  return {
    pi_list: tool({
      description:
        'List Personalised Internet sites (and optional temps). Read-only. Call before creating to avoid duplicates.',
      inputSchema: z.object({
        includeTemps: z.boolean().optional().default(false),
        status: z
          .enum(['active', 'dormant', 'drafting', 'archived'])
          .optional(),
      }),
      execute: async ({ includeTemps, status }) => {
        const sites = listSites(
          status ? { status } : { status: ['active', 'dormant', 'drafting'] },
        ).map((s) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          status: s.status,
          templateId: s.templateId,
          doorwayEligible: !!s.doorwayEligible,
          pulseLine: getPulse(s.id)?.pulseLine ?? null,
          route: `#/pi/sites/${s.id}`,
        }))
        const temps = includeTemps
          ? listTemps().map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              expiresAt: t.expiresAt,
              route: `#/pi/temp/${t.id}`,
            }))
          : undefined
        return ok({ sites, temps })
      },
    }),

    pi_read: tool({
      description:
        'Read a Personalised Internet site, page document, or temp page. Read-only.',
      inputSchema: z.object({
        siteId: z.string().optional(),
        pageId: z.string().optional(),
        tempId: z.string().optional(),
      }),
      execute: async ({ siteId, pageId, tempId }) => {
        if (tempId) {
          const temp = getTemp(tempId)
          if (!temp) return err(`temp not found: ${tempId}`)
          const doc = await readPageDoc(tempId)
          return ok({
            temp,
            doc,
            route: `#/pi/temp/${tempId}`,
          })
        }
        if (pageId) {
          const page = getPage(pageId)
          if (!page) return err(`page not found: ${pageId}`)
          const doc = await readPageDoc(pageId)
          return ok({
            page,
            doc,
            route: page.siteId
              ? `#/pi/sites/${page.siteId}/pages/${pageId}`
              : `#/pi/temp/${pageId}`,
          })
        }
        if (siteId) {
          const site = getSite(siteId)
          if (!site) return err(`site not found: ${siteId}`)
          const pages = listPagesForSite(siteId)
          const pulse = getPulse(siteId)
          return ok({
            site,
            pages,
            pulse,
            route: `#/pi/sites/${siteId}`,
          })
        }
        return err('Provide siteId, pageId, or tempId')
      },
    }),

    pi_pulse_get: tool({
      description:
        'Get the pulse projection for a site (doorway line + urgencies).',
      inputSchema: z.object({
        siteId: z.string().min(1),
      }),
      execute: async ({ siteId }) => {
        const pulse = getPulse(siteId)
        if (!pulse) return err(`no pulse for site: ${siteId}`)
        return ok({ pulse })
      },
    }),

    pi_site_upsert: tool({
      description:
        'Create or upsert a durable Personalised Internet site. Prefer templateId job-search | research-hub | sales-leads (seeds board/table). Load skill "pi-sites" for lifecycle; for freeform pages after, "pi-page-dsl" / "pi-page-patch". Returns siteId, pageId, route — tell the user the #/pi/... link.',
      inputSchema: z.object({
        templateId: templateIdSchema.optional(),
        name: z.string().optional(),
        slug: z.string().optional(),
        jtbd: z.string().optional(),
        harvestEnabled: z.boolean().optional(),
      }),
      execute: async (input) => {
        try {
          const result = await applyPiMutation({
            type: 'upsert-site',
            templateId: input.templateId as PiTemplateId | undefined,
            name: input.name,
            slug: input.slug,
            jtbd: input.jtbd,
            harvestEnabled: input.harvestEnabled,
          })
          return ok({
            ...result,
            piOpenRoute: result.route,
            message: `Site ready. Open ${result.route}`,
          })
        } catch (e) {
          return err(String(e))
        }
      },
    }),

    pi_page_create: tool({
      description:
        'Create a Personalised Internet page as structured DSL JSON (not HTML). mode=temp for one-shot visuals; mode=durable needs siteId. doc={version:1,title,nodes:PiNode[]}. Load "pi-page-dsl"; for chart/mermaid/svg load "pi-page-viz". Returns #/pi/... route.',
      inputSchema: z.object({
        mode: z.enum(['durable', 'temp']),
        siteId: z.string().optional(),
        title: z.string().min(1),
        doc: pageDocSchema,
        kind: z.string().optional(),
        ttlMs: z.number().optional(),
      }),
      execute: async (input) => {
        try {
          const doc = validatePageDoc(input.doc) as PiPageDoc
          const result = await applyPiMutation({
            type: 'create-page',
            mode: input.mode,
            siteId: input.siteId,
            title: input.title,
            doc,
            kind: input.kind,
            ttlMs: input.ttlMs,
          })
          return ok({
            ...result,
            piOpenRoute: result.route,
            message: `Page created. Open ${result.route}`,
          })
        } catch (e) {
          return err(String(e))
        }
      },
    }),

    pi_page_patch: tool({
      description:
        'Patch a page: setTitle, replaceNodes, upsertTableRow, setCell, upsertBoardCard, moveBoardCard, bindRecord. Table row/cell ops hit the first table only — use replaceNodes for multi-table. Load skill "pi-page-patch" for full op shapes.',
      inputSchema: z.object({
        pageId: z.string().min(1),
        ops: z.array(z.record(z.unknown())).min(1),
      }),
      execute: async ({ pageId, ops }) => {
        try {
          const result = await applyPiMutation({
            type: 'patch-page',
            pageId,
            ops: ops as PiPatchOp[],
          })
          return ok({ ...result, piOpenRoute: result.route })
        } catch (e) {
          return err(String(e))
        }
      },
    }),

    pi_page_delete: tool({
      description: 'Delete a page by id. Confirm with the user before calling.',
      inputSchema: z.object({
        pageId: z.string().min(1),
        confirm: z.literal(true),
      }),
      execute: async ({ pageId, confirm }) => {
        if (!confirm) return err('confirm must be true')
        try {
          const page = getPage(pageId)
          if (!page) return err(`page not found: ${pageId}`)
          const result = await applyPiMutation({
            type: 'delete-page',
            pageId,
          })
          return ok({ deleted: true, ...result })
        } catch (e) {
          return err(String(e))
        }
      },
    }),

    pi_site_archive: tool({
      description:
        'Archive a site (removes doorway; keeps data until hard delete).',
      inputSchema: z.object({
        siteId: z.string().min(1),
      }),
      execute: async ({ siteId }) => {
        try {
          const result = await applyPiMutation({
            type: 'archive-site',
            siteId,
          })
          return ok({ ...result, archived: true })
        } catch (e) {
          return err(String(e))
        }
      },
    }),

    pi_preserve_temp: tool({
      description:
        'Preserve a temp page into the private web. mode=attach (needs siteId), new_site, or standalone.',
      inputSchema: z.object({
        tempId: z.string().min(1),
        mode: z.enum(['attach', 'new_site', 'standalone']),
        siteId: z.string().optional(),
        title: z.string().optional(),
        templateId: templateIdSchema.optional(),
      }),
      execute: async (input) => {
        try {
          const result = await preserveTemp({
            tempId: input.tempId,
            mode: input.mode,
            siteId: input.siteId,
            title: input.title,
            templateId: input.templateId as PiTemplateId | undefined,
          })
          return ok({
            ...result,
            piOpenRoute: result.route,
            message: `Preserved. Open ${result.route}`,
          })
        } catch (e) {
          return err(String(e))
        }
      },
    }),

    pi_home_regions_patch: tool({
      description:
        'Patch Personalised Internet home regions: hide/pin doorways and/or set Today continuity blocks. Load skill "pi-home" for when to use. Pass continuity=[] to clear custom Today and fall back to pulse urgencies.',
      inputSchema: z.object({
        hideSiteId: z.string().optional(),
        unhideSiteId: z.string().optional(),
        pinSiteId: z.string().optional(),
        unpinSiteId: z.string().optional(),
        continuity: z
          .array(
            z.object({
              id: z.string().min(1),
              title: z.string().min(1),
              body: z.string().min(1),
              route: z.string().optional(),
              agentQuery: z.string().optional(),
              metadata: z.record(z.unknown()).optional(),
            }),
          )
          .max(5)
          .optional(),
      }),
      execute: async (input) => {
        try {
          const prefs = await readHomePrefs()
          const hidden = new Set(prefs.hiddenSiteIds)
          const pinned = new Set(prefs.pinnedSiteIds)
          if (input.hideSiteId) hidden.add(input.hideSiteId)
          if (input.unhideSiteId) hidden.delete(input.unhideSiteId)
          if (input.pinSiteId) pinned.add(input.pinSiteId)
          if (input.unpinSiteId) pinned.delete(input.unpinSiteId)
          const nextPrefs = {
            hiddenSiteIds: [...hidden],
            pinnedSiteIds: [...pinned],
          }
          await writeHomePrefs(nextPrefs)

          let continuity: PiContinuityBlock[] | undefined
          if (input.continuity !== undefined) {
            const regions = await writeHomeContinuity(
              input.continuity as PiContinuityBlock[],
            )
            continuity = regions.continuity
          } else {
            continuity = (await readHomeRegions()).continuity
          }

          return ok({
            prefs: nextPrefs,
            continuity,
          })
        } catch (e) {
          return err(String(e))
        }
      },
    }),
  }
}
