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
import { indexPiPage, indexPiRecord } from './index-pi'
import { pageFile, siteManifestFile, siteRoute } from './paths'
import { recomputePulse } from './pulse'
import { getSite, listRecords, listSites, newPiId } from './store'

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
      harvestSources: JSON.parse(site.harvestSourcesJson),
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
  return ArchiveSchema.parse({
    format: 'pane-pi-sites',
    version: 1,
    exportedAt: new Date().toISOString(),
    sites: entries,
  })
}

/** Always clone IDs; importing a backup must never update an existing site. */
export async function importPiSites(input: unknown) {
  let archive: PiSiteArchive
  try {
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
  // Board cards use card_<recordId>; remap both cards and column membership.
  const references = new Map(ids)
  for (const site of archive.sites) {
    for (const record of site.records)
      references.set(`card_${record.id}`, `card_${ids.get(record.id)}`)
  }
  const mappedId = (id: string): string => {
    const mapped = ids.get(id)
    if (!mapped) throw new Error('Missing imported ID mapping')
    return mapped
  }
  const remap = (value: unknown): unknown => {
    if (typeof value === 'string')
      return value.replace(/[a-zA-Z0-9_-]+/g, (id) => references.get(id) ?? id)
    if (Array.isArray(value)) return value.map(remap)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, remap(entry)]),
      )
    }
    return value
  }
  const copies = archive.sites.map((site) => ({
    ...site,
    id: mappedId(site.id),
    // A unique slug prevents future upserts from selecting the original site.
    slug: `${site.slug}-import-${mappedId(site.id).slice(-8)}`,
    pages: site.pages.map((page) => ({
      ...page,
      id: mappedId(page.id),
      doc: validatePageDoc(remap(page.doc)),
    })),
    records: site.records.map((record) => ({
      ...record,
      id: mappedId(record.id),
      data: remap(record.data) as Record<string, unknown>,
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
      directories.push(dirname(manifest))
      await mkdir(dirname(manifest), { recursive: true })
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
