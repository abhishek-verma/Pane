/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Agent tools for Personalised Internet. All mutations go through write-path.
 */

import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { getActiveGateContext } from '../agent/trust/gate'
import {
  findActiveMaterializeRunForPage,
  getScheduledRun,
} from '../scheduler/run-executor'
import { describePageRender } from './diagnose'
import { validatePageDoc } from './dsl'
import { getPiFocus } from './focus'
import { ensureAndMaterialize } from './materialize'
import {
  entityHref,
  entityRoute,
  hrefToRoute,
  pageHref,
  parsePiHref,
  routeToHref,
  siteHref,
  tempHref,
} from './paths'
import { pageDocSchema, patchOpSchema } from './pi-node-schema'
import { normalizeJobSearchRecord, parseRecordData } from './records'
import {
  getPage,
  getPulse,
  getSite,
  getTemp,
  inspectPageDoc,
  listPagesForSite,
  listRecords,
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

const templateIdSchema = z.enum([
  'job-search',
  'research-hub',
  'sales-leads',
  'reading-list',
  'habit-tracker',
  'project-tracker',
  'blank',
])

type PiPreview = {
  title: string
  siteName?: string
  pulseLine?: string
  kind: 'site' | 'page' | 'entity' | 'temp' | 'library'
}

function ok(data: Record<string, unknown>) {
  return { text: JSON.stringify(data) }
}

function previewForRoute(
  route: string,
  fallbackTitle?: string,
): PiPreview | null {
  const href = routeToHref(route)
  if (!href) return null
  const parts = parsePiHref(href)
  if (!parts) return null
  switch (parts.kind) {
    case 'library':
      return { title: 'My sites', kind: 'library' }
    case 'site': {
      const site = getSite(parts.siteId)
      return {
        title: site?.name ?? fallbackTitle ?? parts.siteId,
        siteName: site?.name,
        pulseLine: getPulse(parts.siteId)?.pulseLine,
        kind: 'site',
      }
    }
    case 'page': {
      const page = getPage(parts.pageId)
      const site = getSite(parts.siteId)
      return {
        title: page?.title ?? fallbackTitle ?? parts.pageId,
        siteName: site?.name,
        pulseLine: getPulse(parts.siteId)?.pulseLine,
        kind: 'page',
      }
    }
    case 'entity': {
      const site = getSite(parts.siteId)
      return {
        title: fallbackTitle ?? parts.entityKey,
        siteName: site?.name,
        pulseLine: getPulse(parts.siteId)?.pulseLine,
        kind: 'entity',
      }
    }
    case 'temp': {
      const temp = getTemp(parts.tempId)
      return {
        title: temp?.title ?? fallbackTitle ?? parts.tempId,
        kind: 'temp',
      }
    }
  }
}

/** Attach canonical pi:// href + preview; keep route for SPA helpers. */
function withPiAddress(
  data: Record<string, unknown>,
  opts?: { route?: string; title?: string; openHref?: string },
): Record<string, unknown> {
  const route =
    opts?.route ??
    (typeof data.route === 'string' ? data.route : undefined) ??
    (typeof data.entityRoute === 'string' ? data.entityRoute : undefined)
  if (!route) return data
  const href = routeToHref(route)
  if (!href) return { ...data, route }
  const preview = previewForRoute(route, opts?.title) ?? undefined
  const openHref = opts?.openHref ?? href
  return {
    ...data,
    route,
    href,
    preview,
    piOpenRoute: openHref,
  }
}

function isActiveMaterializeStatus(status: string): boolean {
  return (
    status === 'pending' ||
    status === 'running' ||
    status === 'awaiting-approval'
  )
}

/** While a pi-materialize run is active, restrict create/ensure/cross-page patch. */
function assertMaterializeToolAllowed(
  toolName: string,
  args: { pageId?: string; entityKey?: string },
): void {
  // Prefer the scheduled run on this turn (survives focus/process drift).
  const scheduledRunId = getActiveGateContext()?.scheduledRunId
  let run = scheduledRunId ? getScheduledRun(scheduledRunId) : null
  if (
    run?.source !== 'pi-materialize' ||
    !isActiveMaterializeStatus(run.status)
  ) {
    const focus = getPiFocus()
    if (!focus) return
    run = focus.runId ? getScheduledRun(focus.runId) : null
    if (
      run?.source !== 'pi-materialize' ||
      !isActiveMaterializeStatus(run.status)
    ) {
      run = findActiveMaterializeRunForPage(focus.pageId)
    }
  }
  if (
    run?.source !== 'pi-materialize' ||
    !isActiveMaterializeStatus(run.status)
  ) {
    return
  }
  const targetPageId = run.sourceId
  if (!targetPageId) return

  if (toolName === 'pi_page_create' || toolName === 'pi_entity_ensure') {
    throw new Error(
      `pi-materialize run may not call ${toolName}; use pi_page_patch on pageId=${targetPageId} only`,
    )
  }
  if (
    toolName === 'pi_page_patch' &&
    args.pageId &&
    args.pageId !== targetPageId
  ) {
    throw new Error(
      `pi-materialize may only patch pageId=${targetPageId} (got ${args.pageId})`,
    )
  }
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
        ).map((s) => {
          const route = `#/pi/sites/${s.id}`
          return {
            id: s.id,
            name: s.name,
            slug: s.slug,
            status: s.status,
            templateId: s.templateId,
            doorwayEligible: !!s.doorwayEligible,
            pulseLine: getPulse(s.id)?.pulseLine ?? null,
            route,
            href: siteHref(s.id),
          }
        })
        const temps = includeTemps
          ? listTemps().map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              expiresAt: t.expiresAt,
              route: `#/pi/temp/${t.id}`,
              href: tempHref(t.id),
            }))
          : undefined
        return ok({ sites, temps })
      },
    }),

    pi_read: tool({
      description:
        'Read a Personalised Internet site, page document, or temp page. Read-only. For pages: returns renderPreview — a plain-English, top-to-bottom outline of how the page actually looks to the user (headings, paragraphs, tables, board columns/cards, charts) — read that instead of the raw doc tree to check a page matches what the user expects. Also returns diagnosis.agentBrief (structured repair plan) and contentSummary. Raw JSON only when diagnosis.needsRaw. Prefer following agentBrief with pi_page_patch over interpreting raw validator errors.',
      inputSchema: z.object({
        siteId: z.string().optional(),
        pageId: z.string().optional(),
        tempId: z.string().optional(),
      }),
      execute: async ({ siteId, pageId, tempId }) => {
        if (tempId) {
          const temp = getTemp(tempId)
          if (!temp) return err(`temp not found: ${tempId}`)
          const inspection = await inspectPageDoc(tempId)
          return ok(
            withPiAddress(
              {
                temp,
                doc: inspection?.doc ?? null,
                raw: inspection?.raw ?? null,
                ok: inspection?.ok ?? false,
                issues: inspection?.issues ?? ['temp doc missing'],
                fixHint: inspection?.fixHint,
                route: `#/pi/temp/${tempId}`,
              },
              { title: temp.title },
            ),
          )
        }
        if (pageId) {
          const page = getPage(pageId)
          if (!page) return err(`page not found: ${pageId}`)
          const inspection = await inspectPageDoc(pageId)
          if (!inspection) return err(`page not found: ${pageId}`)
          // Persist auto-repairs so the next read is clean.
          if (inspection.doc) await readPageDoc(pageId)
          const needsAgent = inspection.diagnosis.findings.some(
            (f) => f.severity === 'needs_agent',
          )
          return ok(
            withPiAddress(
              {
                page,
                doc: inspection.doc,
                ok: inspection.ok,
                diagnosis: {
                  agentBrief: inspection.diagnosis.agentBrief,
                  needsRaw: inspection.diagnosis.needsRaw,
                  findings: inspection.diagnosis.findings,
                  autoFixesApplied: inspection.diagnosis.autoFixesApplied,
                },
                contentSummary: inspection.contentSummary,
                renderPreview: inspection.doc
                  ? describePageRender(inspection.doc)
                  : undefined,
                ...(inspection.diagnosis.needsRaw || needsAgent
                  ? {
                      raw: inspection.diagnosis.needsRaw
                        ? inspection.raw
                        : undefined,
                    }
                  : {}),
                issues: inspection.issues,
                fixHint: inspection.fixHint,
                route: inspection.route,
                message: needsAgent
                  ? `Follow diagnosis.agentBrief. ${inspection.diagnosis.agentBrief.slice(0, 400)}`
                  : inspection.ok
                    ? undefined
                    : 'Page could not be loaded; see diagnosis.',
              },
              { title: page.title },
            ),
          )
        }
        if (siteId) {
          const site = getSite(siteId)
          if (!site) return err(`site not found: ${siteId}`)
          const pages = listPagesForSite(siteId)
          const pulse = getPulse(siteId)
          return ok(
            withPiAddress(
              {
                site,
                pages,
                pulse,
                route: `#/pi/sites/${siteId}`,
              },
              { title: site.name },
            ),
          )
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

    pi_record_list: tool({
      description:
        'List Personalised Internet records for a site (source of truth for Job Search applications). Read-only. Prefer this over scraping board JSON when answering pipeline questions. If the workspace also has memory/vault markdown files (e.g. Interviews/Pipeline-*.md) mentioning the same entities, those are a separate, potentially-stale tracker — records here are authoritative for board/chart state; do not spend tool calls reconciling every discrepancy against vault files unless the user specifically asks you to import/audit them.',
      inputSchema: z.object({
        siteId: z.string().min(1),
        type: z.string().optional(),
      }),
      execute: async ({ siteId, type }) => {
        const site = getSite(siteId)
        if (!site) return err(`site not found: ${siteId}`)
        const records = listRecords(siteId)
          .filter((r) => (type ? r.type === type : true))
          .map((r) => {
            const data = parseRecordData(r)
            let entityKey: string | undefined
            try {
              entityKey = normalizeJobSearchRecord(data).entityKey
            } catch {
              entityKey =
                typeof data.entityKey === 'string' ? data.entityKey : undefined
            }
            const eRoute = entityKey ? entityRoute(siteId, entityKey) : null
            return {
              id: r.id,
              type: r.type,
              version: r.version,
              updatedAt: r.updatedAt,
              data,
              entityKey,
              entityRoute: eRoute,
              href: entityKey ? entityHref(siteId, entityKey) : null,
            }
          })
        return ok({ siteId, records, count: records.length })
      },
    }),

    pi_record_upsert: tool({
      description:
        'Create or update a site record (Job Search SoT). Use recordType job-application with {company, role?, stage, url?, nextAction?, notes?}. Syncs board/chart by default. Do NOT invent companies. Prefer this over only patching board cards. Load skill "pi-sites". Returns pi:// href.',
      inputSchema: z.object({
        siteId: z.string().min(1),
        recordId: z.string().optional(),
        recordType: z.string().min(1).default('job-application'),
        data: z.record(z.unknown()),
        syncBoard: z.boolean().optional().default(true),
        expectedVersion: z.number().optional(),
      }),
      execute: async (input) => {
        try {
          const result = await applyPiMutation({
            type: 'upsert-record',
            siteId: input.siteId,
            recordId: input.recordId,
            recordType: input.recordType,
            data: input.data as Record<string, unknown>,
            syncBoard: input.syncBoard,
            expectedVersion: input.expectedVersion,
          })
          const linked = withPiAddress({ ...result })
          return ok({
            ...linked,
            message: `Record saved. Pulse: ${result.pulseLine ?? 'n/a'}. ${linked.href ?? ''}`,
          })
        } catch (e) {
          return err(String(e))
        }
      },
    }),

    pi_record_upsert_many: tool({
      description:
        'Create or update multiple site records in one call (Job Search SoT). Prefer this over calling pi_record_upsert once per record — each individual call re-syncs the board/chart, so N separate calls costs N resyncs and N tool-call round-trips; this tool resyncs once after all records are written. Use recordType job-application with {company, role?, stage, url?, nextAction?, notes?} per record. Do NOT invent companies. Load skill "pi-sites".',
      inputSchema: z.object({
        siteId: z.string().min(1),
        records: z
          .array(
            z.object({
              recordId: z.string().optional(),
              recordType: z.string().min(1).default('job-application'),
              data: z.record(z.unknown()),
            }),
          )
          .min(1)
          .max(50),
        syncBoard: z.boolean().optional().default(true),
      }),
      execute: async ({ siteId, records, syncBoard }) => {
        const results: Array<
          { ok: true; recordId: string } | { ok: false; error: string }
        > = []
        for (const [i, r] of records.entries()) {
          const isLast = i === records.length - 1
          try {
            const result = await applyPiMutation({
              type: 'upsert-record',
              siteId,
              recordId: r.recordId,
              recordType: r.recordType,
              data: r.data as Record<string, unknown>,
              syncBoard: syncBoard && isLast,
            })
            results.push({ ok: true, recordId: result.recordId! })
          } catch (e) {
            results.push({ ok: false, error: String(e) })
          }
        }
        const succeeded = results.filter((r) => r.ok).length
        return ok({
          siteId,
          count: records.length,
          succeeded,
          results,
          message: `${succeeded}/${records.length} records saved.`,
        })
      },
    }),

    pi_entity_ensure: tool({
      description:
        'Ensure a per-company (entity) ATF page exists at pi://sites/<siteId>/entities/<entityKey>. Default materialize=false (cheap ATF only). Set materialize=true only when the user asked to deepen that one company. Never create one mega details page for all companies. During a pi-materialize run, do not call this for other entities. Share the pi:// href; call pi_open when the user should see it now.',
      inputSchema: z.object({
        siteId: z.string().min(1),
        entityKey: z.string().min(1),
        materialize: z.boolean().optional().default(false),
      }),
      execute: async ({ siteId, entityKey, materialize }) => {
        try {
          assertMaterializeToolAllowed('pi_entity_ensure', { entityKey })
          const result = await ensureAndMaterialize(siteId, entityKey, {
            materialize,
          })
          const linked = withPiAddress(
            { ...result, route: result.entityRoute },
            { title: entityKey, openHref: entityHref(siteId, entityKey) },
          )
          return ok({
            ...linked,
            message: `Entity page ready. ${linked.href}`,
          })
        } catch (e) {
          return err(String(e))
        }
      },
    }),

    pi_site_upsert: tool({
      description:
        'Create or upsert a durable Personalised Internet site. Prefer templateId job-search | research-hub | sales-leads | reading-list | habit-tracker | project-tracker when it fits (seeds board/table); use templateId=blank for a freeform site with no starter structure when nothing else fits. blank has no singleton slug — ALWAYS pass an explicit unique slug/name for it, or repeated calls without one create a new random-slugged site each time. On create, returns harvestOffer.proposedConfig — present it to the user, fill harvestSources from conversation provenance, and only set harvest fields after the user accepts or revises. Load skill "pi-sites". Returns siteId, pageId, href (pi://…) — share that link; call pi_open when the user should see the site now.',
      inputSchema: z.object({
        templateId: templateIdSchema.optional(),
        name: z.string().optional(),
        slug: z.string().optional(),
        jtbd: z.string().optional(),
        harvestEnabled: z.boolean().optional(),
        harvestSources: z.array(z.string()).optional(),
        harvestCadenceDays: z.number().int().min(1).max(30).optional(),
        harvestInstructions: z.string().optional(),
        harvestFromMeetings: z.boolean().optional(),
        harvestOnHostOpened: z.boolean().optional(),
        harvestAllowNavigate: z.boolean().optional(),
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
            harvestSources: input.harvestSources,
            harvestCadenceDays: input.harvestCadenceDays,
            harvestInstructions: input.harvestInstructions,
            harvestFromMeetings: input.harvestFromMeetings,
            harvestOnHostOpened: input.harvestOnHostOpened,
            harvestAllowNavigate: input.harvestAllowNavigate,
          })
          const linked = withPiAddress({ ...result }, { title: input.name })
          return ok({
            ...linked,
            harvestOffer: result.harvestOffer,
            harvestConfig: result.harvestConfig,
            message: result.harvestOffer
              ? `Site ready. ${linked.href} Propose harvest config from harvestOffer before enabling.`
              : `Site ready. ${linked.href}`,
          })
        } catch (e) {
          return err(String(e))
        }
      },
    }),

    pi_page_create: tool({
      description:
        'Create a Personalised Internet page as structured DSL JSON (not HTML). mode=temp for one-shot visuals; mode=durable needs siteId. doc={version:1,title,nodes:PiNode[]}. Boards MUST use columns[].cardIds + cards[].{id,title,subtitle?} — never card.columnId/description (that fails validation). Prefer empty board + upsertBoardCard for cards. MUST call skills_load("pi-page-dsl") first unless you already have its node/board schema in context this turn; for chart/mermaid/svg also load "pi-page-viz". Returns pi:// href and renderPreview (plain-English outline of how it will actually look — check it matches what the user asked for before replying). Share the href; call pi_open when the user should see the page now. Not allowed during a pi-materialize BTF run — patch the bound pageId instead.',
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
          assertMaterializeToolAllowed('pi_page_create', {})
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
          const linked = withPiAddress({ ...result }, { title: input.title })
          const renderPreview = result.doc
            ? describePageRender(result.doc)
            : undefined
          return ok({
            ...linked,
            renderPreview,
            message: `Page created. ${linked.href}${renderPreview ? `\n\nRenders as:\n${renderPreview}` : ''}`,
          })
        } catch (e) {
          return err(String(e))
        }
      },
    }),

    pi_page_patch: tool({
      description:
        'Patch a page. For a single text/note/title/badge node, prefer setNodeText { id, text } over replaceNodes — the node needs an id (set one when creating it). Prefer upsertBoardCard { id, title, columnId, subtitle? } to add/move cards — do not rewrite boards with card.columnId. Prefer appendNodes for BTF fills, in batches under ~40 nodes per call — split a large addition across multiple appendNodes calls rather than one giant call, which is the most common cause of a broken tool-call JSON payload. replaceNodes with a single section can wipe ATF (server may coerce to append during materialize); only use it as a last resort when no targeted op fits. Table row/cell ops hit the first table only. During pi-materialize, only the run\'s pageId is allowed. MUST call skills_load("pi-page-patch") first (also "pi-entity-materialize" during a materialize run) unless you already have the op shapes in context this turn. Returns renderPreview — a plain-English outline of the patched page as the user will see it; check it before telling the user it\'s done.',
      inputSchema: z.object({
        pageId: z.string().min(1),
        ops: z.array(patchOpSchema).min(1),
      }),
      execute: async ({ pageId, ops }) => {
        try {
          assertMaterializeToolAllowed('pi_page_patch', { pageId })
          const result = await applyPiMutation({
            type: 'patch-page',
            pageId,
            ops: ops as PiPatchOp[],
          })
          const linked = withPiAddress({ ...result })
          const renderPreview = result.doc
            ? describePageRender(result.doc)
            : undefined
          return ok({
            ...linked,
            renderPreview,
            message: renderPreview
              ? `Page updated. Renders as:\n${renderPreview}`
              : 'Page updated.',
          })
        } catch (e) {
          return err(String(e))
        }
      },
    }),

    pi_open: tool({
      description:
        'Open a Personalised Internet page for the user in Pane (navigates to the pi:// address). Use when the turn’s deliverable is a page they should see now — after create/show/open requests. Do NOT call for multi-page batches or side-effect listings; share the pi:// href instead. Pass href (pi://…) or ids.',
      inputSchema: z.object({
        href: z.string().optional(),
        siteId: z.string().optional(),
        pageId: z.string().optional(),
        tempId: z.string().optional(),
        entityKey: z.string().optional(),
      }),
      execute: async (input) => {
        let href = input.href?.trim()
        if (!href) {
          if (input.tempId) href = tempHref(input.tempId)
          else if (input.siteId && input.entityKey)
            href = entityHref(input.siteId, input.entityKey)
          else if (input.siteId && input.pageId)
            href = pageHref(input.siteId, input.pageId)
          else if (input.siteId) href = siteHref(input.siteId)
          else return err('Provide href or siteId/pageId/tempId/entityKey')
        }
        if (!href.startsWith('pi://')) {
          if (href.startsWith('#/pi/') || href.startsWith('/pi/')) {
            const mapped = routeToHref(href.startsWith('#') ? href : `#${href}`)
            if (!mapped) return err(`Unrecognized PI route: ${href}`)
            href = mapped
          } else {
            return err(`Invalid PI address (want pi://…): ${href}`)
          }
        }
        const parts = parsePiHref(href)
        if (!parts) return err(`Unrecognized pi:// address: ${href}`)

        if (parts.kind === 'site' && !getSite(parts.siteId)) {
          return err(`site not found: ${parts.siteId}`)
        }
        if (parts.kind === 'page' && !getPage(parts.pageId)) {
          return err(`page not found: ${parts.pageId}`)
        }
        if (parts.kind === 'temp' && !getTemp(parts.tempId)) {
          return err(`temp not found: ${parts.tempId}`)
        }
        if (parts.kind === 'entity' && !getSite(parts.siteId)) {
          return err(`site not found: ${parts.siteId}`)
        }

        const route = hrefToRoute(href)
        if (!route) return err(`Could not map href: ${href}`)
        const preview = previewForRoute(route)
        return ok({
          type: 'pi_page',
          href,
          route,
          preview,
          navigate: true,
          message: `Opening ${href}`,
        })
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
          const linked = withPiAddress({ ...result })
          return ok({
            ...linked,
            message: `Preserved. ${linked.href}`,
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
            dismissedContinuityIds: prefs.dismissedContinuityIds,
            dismissedProposeIds: prefs.dismissedProposeIds,
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
