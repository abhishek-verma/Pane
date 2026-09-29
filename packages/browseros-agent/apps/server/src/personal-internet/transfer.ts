/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDbHandle } from '../lib/db'
import { piPages, piRecords, piSites } from '../lib/db/schema/personal-internet'
import { validatePageDoc } from './dsl'
import { emitPiEvent } from './events'
import { harvestConfigFromSite } from './harvest-config'
import { indexPiPage, indexPiRecord } from './index-pi'
import { pageFile, siteManifestFile, siteRoute } from './paths'
import { recomputePulse } from './pulse'
import { getSite, listRecords, listSites, newPiId } from './store'
import type { PiNode, PiPageDoc } from './types'

export const MAX_PI_ARCHIVE_BYTES = 16 * 1024 * 1024

const Id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+$/)
const Status = z.enum(['active', 'dormant', 'drafting', 'archived'])
const SiteSchema = z.object({
  id: Id,
  name: z.string().min(1).max(1000),
  slug: z.string().min(1).max(1000),
  jtbd: z.string(),
  status: Status,
  templateId: z.string().nullable(),
  doorwayEligible: z.boolean(),
  harvestSources: z.array(z.string()),
  harvestCadenceDays: z.number().int().min(1).max(30),
  harvestInstructions: z.string(),
  pages: z.array(
    z.object({
      id: Id,
      kind: z.string().min(1),
      status: z.enum(['active', 'archived']),
      doc: z.unknown().transform((doc) => validatePageDoc(doc)),
    }),
  ),
  records: z.array(
    z.object({
      id: Id,
      type: z.string().min(1),
      data: z.record(z.unknown()),
    }),
  ),
})

const ArchiveSchema = z.object({
  format: z.literal('pane-pi-sites'),
  version: z.literal(1),
  exportedAt: z.string(),
  sites: z.array(SiteSchema).min(1).max(1000),
})

export type PiSiteArchive = z.infer<typeof ArchiveSchema>

export async function exportPiSites(siteId?: string): Promise<PiSiteArchive> {
  const sites = siteId
    ? [getSite(siteId)]
        .filter((site) => site !== null)
        .filter((site) => site.status !== 'deleted')
    : listSites({ status: ['active', 'dormant', 'drafting', 'archived'] })
  if (!sites.length) throw new Error('No sites to export.')
  const { db } = getDbHandle()
  const entries = []
  for (const site of sites) {
    const pages = []
    for (const page of db
      .select()
      .from(piPages)
      .where(eq(piPages.siteId, site.id))
      .all()) {
      // Never silently drop unreadable pages from a backup.
      let doc: unknown
      try {
        doc = JSON.parse(await readFile(page.filePath, 'utf-8'))
        doc = validatePageDoc(doc)
      } catch {
        throw new Error(
          `Could not export page "${page.title}". Repair it and try again.`,
        )
      }
      pages.push({ id: page.id, kind: page.kind, status: page.status, doc })
    }
    entries.push({
      id: site.id,
      name: site.name,
      slug: site.slug,
      jtbd: site.jtbd,
      status: site.status,
      templateId: site.templateId,
      doorwayEligible: !!site.doorwayEligible,
      harvestSources: harvestConfigFromSite(site).sources,
      harvestCadenceDays: site.harvestCadenceDays,
      harvestInstructions: site.harvestInstructions,
      pages,
      records: listRecords(site.id).map((record) => ({
        id: record.id,
        type: record.type,
        data: JSON.parse(record.dataJson),
      })),
    })
  }
  const archive = ArchiveSchema.parse({
    format: 'pane-pi-sites',
    version: 1,
    exportedAt: new Date().toISOString(),
    sites: entries,
  })
  if (
    Buffer.byteLength(JSON.stringify(archive), 'utf8') > MAX_PI_ARCHIVE_BYTES
  ) {
    throw new Error(
      'Export exceeds the 16 MB import limit. Export smaller sites individually.',
    )
  }
  return archive
}

// Check before recursive DSL validation/remapping so malformed JSON returns 400,
// rather than overflowing the stack partway through an import.
function validateArchiveDepth(input: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value: input, depth: 0 },
  ]
  while (pending.length) {
    const item = pending.pop()
    if (!item?.value || typeof item.value !== 'object') continue
    if (item.depth > 100)
      throw new InvalidPiArchiveError('PI sites file is nested too deeply.')
    for (const value of Object.values(item.value))
      pending.push({ value, depth: item.depth + 1 })
  }
}

function remapReferences(
  value: unknown,
  ids: Map<string, string>,
  key?: string,
): unknown {
  if (typeof value === 'string') {
    if (key === 'siteId' || key === 'pageId' || key === 'recordId')
      return ids.get(value) ?? value
    // Only PI links change inside prose. Never rewrite DSL discriminants, titles,
    // entity keys, arbitrary record values, or unrelated external URL segments.
    return value.replace(
      /(?:pi:\/\/sites\/|#\/pi\/sites\/|(?<![a-zA-Z0-9:/])\/pi\/sites\/)([a-zA-Z0-9_-]+)(?:\/pages\/([a-zA-Z0-9_-]+))?/g,
      (link, siteId: string, pageId: string | undefined) => {
        let next = link.replace(
          `sites/${siteId}`,
          `sites/${ids.get(siteId) ?? siteId}`,
        )
        if (pageId)
          next = next.replace(
            `pages/${pageId}`,
            `pages/${ids.get(pageId) ?? pageId}`,
          )
        return next
      },
    )
  }
  if (Array.isArray(value))
    return value.map((entry) => remapReferences(entry, ids, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([field, entry]) => [
        field,
        remapReferences(entry, ids, field),
      ]),
    )
  }
  return value
}

function remapPage(
  doc: PiPageDoc,
  ids: Map<string, string>,
  recordIds: Set<string>,
): PiPageDoc {
  // Board dragging derives a record ID from card_<recordId>, even when the
  // card has no explicit binding. Give unbound cards fresh IDs as well.
  const visit = (node: PiNode): PiNode => {
    if (node.type === 'board') {
      const cardIds = new Map<string, string>()
      const cards = node.cards.map((card) => {
        if (card.recordId && !recordIds.has(card.recordId)) {
          throw new InvalidPiArchiveError(
            'Page refers to a record outside its imported site.',
          )
        }
        const binding =
          card.id.startsWith('card_') && recordIds.has(card.id.slice(5))
            ? card.id.slice(5)
            : undefined
        const id = binding
          ? `card_${ids.get(binding)}`
          : card.id.startsWith('card_')
            ? newPiId('card')
            : card.id
        cardIds.set(card.id, id)
        return { ...card, id }
      })
      return {
        ...node,
        cards,
        columns: node.columns.map((column) => ({
          ...column,
          cardIds: column.cardIds.map((id) => cardIds.get(id) ?? id),
        })),
      }
    }
    if (node.type === 'stack')
      return { ...node, children: node.children.map(visit) }
    if (node.type === 'button' && node.replaceWith)
      return { ...node, replaceWith: visit(node.replaceWith) }
    if (node.type === 'table')
      return {
        ...node,
        rows: node.rows.map((row) => {
          if (row.recordId && !recordIds.has(row.recordId))
            throw new InvalidPiArchiveError(
              'Page refers to a record outside its imported site.',
            )
          return {
            ...row,
            cells: Object.fromEntries(
              Object.entries(row.cells).map(([key, cell]) => [
                key,
                typeof cell === 'string' ? cell : visit(cell),
              ]),
            ),
          }
        }),
      }
    return node
  }
  try {
    return validatePageDoc(
      remapReferences({ ...doc, nodes: doc.nodes.map(visit) }, ids),
    )
  } catch (error) {
    if (error instanceof InvalidPiArchiveError) throw error
    throw new InvalidPiArchiveError(
      'Page references could not be imported. Repair the page and export it again.',
    )
  }
}

/** Always clone IDs; importing a backup must never update an existing site. */
export async function importPiSites(input: unknown) {
  let archive: PiSiteArchive
  try {
    validateArchiveDepth(input)
    archive = ArchiveSchema.parse(input)
  } catch {
    throw new InvalidPiArchiveError(
      'Invalid PI sites file. Choose a version 1 Pane PI sites export.',
    )
  }
  const ids = new Map<string, string>()
  const addId = (old: string, prefix: string) => {
    if (ids.has(old))
      throw new InvalidPiArchiveError(`Duplicate ID in PI sites file: ${old}`)
    ids.set(old, newPiId(prefix))
  }
  for (const site of archive.sites) {
    addId(site.id, 'site')
    for (const page of site.pages) addId(page.id, 'page')
    for (const record of site.records) addId(record.id, 'rec')
  }
  const mappedId = (id: string): string => {
    const mapped = ids.get(id)
    if (!mapped) throw new Error('Missing imported ID mapping')
    return mapped
  }
  const copies = archive.sites.map((site) => ({
    ...site,
    id: mappedId(site.id),
    // A unique slug prevents future upserts from selecting the original site.
    slug: `${site.slug.slice(0, 975)}-import-${mappedId(site.id).slice(-8)}`,
    pages: site.pages.map((page) => ({
      ...page,
      id: mappedId(page.id),
      doc: remapPage(
        page.doc,
        ids,
        new Set(site.records.map((record) => record.id)),
      ),
    })),
    records: site.records.map((record) => ({
      ...record,
      id: mappedId(record.id),
      data: remapReferences(record.data, ids) as Record<string, unknown>,
    })),
  }))
  const directories: string[] = []
  const { db, sqlite } = getDbHandle()
  const now = Date.now()
  try {
    // Stage all files before publishing any DB rows. Only locally generated IDs
    // enter paths; no path or profile/bucket from the archive is trusted.
    for (const site of copies) {
      const manifest = siteManifestFile(site.id)
      await mkdir(dirname(dirname(manifest)), { recursive: true })
      // Reserve a new directory exclusively; never overwrite or clean up an
      // existing directory/symlink if an ID collision occurs.
      await mkdir(dirname(manifest))
      directories.push(dirname(manifest))
      await writeFile(
        manifest,
        `# ${site.name}\n\nslug: ${site.slug}\nstatus: ${site.status}\njtbd: ${site.jtbd}\n`,
      )
      for (const page of site.pages) {
        const path = pageFile(site.id, page.id)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, JSON.stringify(page.doc, null, 2))
      }
    }
    // Rows and search indexes commit together, or none of the import is visible.
    sqlite.transaction(() => {
      for (const site of copies) {
        db.insert(piSites)
          .values({
            id: site.id,
            name: site.name,
            slug: site.slug,
            jtbd: site.jtbd,
            status: site.status,
            templateId: site.templateId,
            doorwayEligible: Number(site.doorwayEligible),
            harvestSourcesJson: JSON.stringify(site.harvestSources),
            harvestCadenceDays: site.harvestCadenceDays,
            harvestInstructions: site.harvestInstructions,
            // Importing content does not authorize background browsing on this profile.
            harvestEnabled: 0,
            createdAt: now,
            updatedAt: now,
            archivedAt: site.status === 'archived' ? now : null,
          })
          .run()
        for (const page of site.pages) {
          db.insert(piPages)
            .values({
              id: page.id,
              siteId: site.id,
              kind: page.kind,
              title: page.doc.title,
              status: page.status,
              filePath: pageFile(site.id, page.id),
              createdAt: now,
              updatedAt: now,
            })
            .run()
          if (site.status !== 'archived' && page.status !== 'archived') {
            indexPiPage(page.id, 'default', site.id, page.doc.title, page.doc)
          }
        }
        for (const record of site.records) {
          db.insert(piRecords)
            .values({
              id: record.id,
              siteId: site.id,
              type: record.type,
              dataJson: JSON.stringify(record.data),
              createdAt: now,
              updatedAt: now,
            })
            .run()
          if (site.status !== 'archived')
            indexPiRecord(
              record.id,
              site.id,
              'default',
              record.type,
              record.data,
            )
        }
        recomputePulse(site.id)
      }
    })()
  } catch (error) {
    await Promise.all(
      directories.map((path) => rm(path, { recursive: true, force: true })),
    )
    throw error
  }
  for (const site of copies) emitPiEvent('site-created', { siteId: site.id })
  return {
    sites: copies.map((site) => ({
      siteId: site.id,
      name: site.name,
      route: siteRoute(site.id),
    })),
  }
}

export class InvalidPiArchiveError extends Error {}
