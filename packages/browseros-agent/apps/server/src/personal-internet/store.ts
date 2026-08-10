/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getDbHandle } from '../lib/db'
import type {
  PiPageRow,
  PiRecordRow,
  PiSiteRow,
  PiTempRow,
} from '../lib/db/schema/personal-internet'
import { validatePageDoc } from './dsl'
import {
  clampCadenceDays,
  normalizeHarvestSources,
  primaryHarvestHost,
} from './harvest-config'
import { removePiIndex, removePiSiteIndex } from './index-pi'
import { inspectPageFile, type PiPageInspection } from './inspect'
import {
  homePrefsFile,
  homeRegionsFile,
  pageFile,
  siteManifestFile,
  tempFile,
} from './paths'
import type {
  PiContinuityBlock,
  PiPageDoc,
  PiPulse,
  PiRefreshPolicy,
  PiSiteStatus,
} from './types'

function sqlite() {
  return getDbHandle().sqlite
}

function now() {
  return Date.now()
}

export function newPiId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export type UpsertSiteInput = {
  id?: string
  name: string
  slug: string
  jtbd?: string
  status?: PiSiteStatus
  templateId?: string | null
  harvestEnabled?: boolean
  harvestHost?: string | null
  harvestSources?: string[]
  harvestCadenceDays?: number
  harvestInstructions?: string
  harvestFromMeetings?: boolean
  harvestOnHostOpened?: boolean
  harvestAllowNavigate?: boolean
  lastHarvestAt?: number | null
  doorwayEligible?: boolean
  bucketId?: string
}

export async function upsertSite(input: UpsertSiteInput): Promise<PiSiteRow> {
  const ts = now()
  const existing = input.id ? getSite(input.id) : getSiteBySlug(input.slug)
  const id = existing?.id ?? input.id ?? newPiId('site')

  let sources: string[]
  if (input.harvestSources !== undefined) {
    sources = normalizeHarvestSources(input.harvestSources)
  } else if (existing?.harvestSourcesJson) {
    try {
      sources = normalizeHarvestSources(JSON.parse(existing.harvestSourcesJson))
    } catch {
      sources = existing.harvestHost
        ? normalizeHarvestSources([existing.harvestHost])
        : []
    }
  } else {
    sources = existing?.harvestHost
      ? normalizeHarvestSources([existing.harvestHost])
      : []
  }
  if (
    input.harvestSources === undefined &&
    input.harvestHost !== undefined &&
    input.harvestHost
  ) {
    sources = normalizeHarvestSources([input.harvestHost, ...sources])
  }
  const harvestHost =
    input.harvestHost !== undefined && input.harvestSources === undefined
      ? input.harvestHost
      : primaryHarvestHost(sources)

  const row = {
    id,
    bucket_id: input.bucketId ?? existing?.bucketId ?? 'default',
    name: input.name,
    slug: input.slug,
    jtbd: input.jtbd ?? existing?.jtbd ?? '',
    status: input.status ?? existing?.status ?? 'active',
    template_id: input.templateId ?? existing?.templateId ?? null,
    harvest_enabled:
      input.harvestEnabled === undefined
        ? (existing?.harvestEnabled ?? 0)
        : input.harvestEnabled
          ? 1
          : 0,
    harvest_host: harvestHost,
    harvest_sources_json: JSON.stringify(sources),
    harvest_cadence_days:
      input.harvestCadenceDays === undefined
        ? clampCadenceDays(existing?.harvestCadenceDays ?? 1)
        : clampCadenceDays(input.harvestCadenceDays),
    harvest_instructions:
      input.harvestInstructions === undefined
        ? (existing?.harvestInstructions ?? '')
        : input.harvestInstructions,
    harvest_from_meetings:
      input.harvestFromMeetings === undefined
        ? (existing?.harvestFromMeetings ?? 0)
        : input.harvestFromMeetings
          ? 1
          : 0,
    harvest_on_host_opened:
      input.harvestOnHostOpened === undefined
        ? (existing?.harvestOnHostOpened ?? 0)
        : input.harvestOnHostOpened
          ? 1
          : 0,
    harvest_allow_navigate:
      input.harvestAllowNavigate === undefined
        ? (existing?.harvestAllowNavigate ?? 0)
        : input.harvestAllowNavigate
          ? 1
          : 0,
    last_harvest_at:
      input.lastHarvestAt === undefined
        ? (existing?.lastHarvestAt ?? null)
        : input.lastHarvestAt,
    doorway_eligible:
      input.doorwayEligible === undefined
        ? (existing?.doorwayEligible ?? 0)
        : input.doorwayEligible
          ? 1
          : 0,
    created_at: existing?.createdAt ?? ts,
    updated_at: ts,
    archived_at: existing?.archivedAt ?? null,
  }
  sqlite()
    .prepare(
      `INSERT OR REPLACE INTO pi_sites
        (id, bucket_id, name, slug, jtbd, status, template_id, harvest_enabled,
         harvest_host, harvest_sources_json, harvest_cadence_days, harvest_instructions,
         harvest_from_meetings, harvest_on_host_opened, harvest_allow_navigate,
         last_harvest_at, doorway_eligible, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.bucket_id,
      row.name,
      row.slug,
      row.jtbd,
      row.status,
      row.template_id,
      row.harvest_enabled,
      row.harvest_host,
      row.harvest_sources_json,
      row.harvest_cadence_days,
      row.harvest_instructions,
      row.harvest_from_meetings,
      row.harvest_on_host_opened,
      row.harvest_allow_navigate,
      row.last_harvest_at,
      row.doorway_eligible,
      row.created_at,
      row.updated_at,
      row.archived_at,
    )

  const manifest = `# ${row.name}\n\nslug: ${row.slug}\nstatus: ${row.status}\njtbd: ${row.jtbd}\n`
  const path = siteManifestFile(id)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, manifest, 'utf-8')
  return getSite(id)!
}

function rowToSite(row: Record<string, unknown>): PiSiteRow {
  const sourcesJson =
    (row.harvest_sources_json as string | null | undefined) ?? '[]'
  const harvestHost = (row.harvest_host as string | null) ?? null
  return {
    id: row.id as string,
    bucketId: row.bucket_id as string,
    name: row.name as string,
    slug: row.slug as string,
    jtbd: row.jtbd as string,
    status: row.status as string,
    templateId: (row.template_id as string | null) ?? null,
    harvestEnabled: (row.harvest_enabled as number) ?? 0,
    harvestHost,
    harvestSourcesJson: sourcesJson,
    harvestCadenceDays: (row.harvest_cadence_days as number) ?? 1,
    harvestInstructions: (row.harvest_instructions as string) ?? '',
    harvestFromMeetings: (row.harvest_from_meetings as number) ?? 0,
    harvestOnHostOpened: (row.harvest_on_host_opened as number) ?? 0,
    harvestAllowNavigate: (row.harvest_allow_navigate as number) ?? 0,
    lastHarvestAt: (row.last_harvest_at as number | null) ?? null,
    doorwayEligible: row.doorway_eligible as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    archivedAt: (row.archived_at as number | null) ?? null,
  }
}

export function setSiteLastHarvestAt(siteId: string, at: number): void {
  sqlite()
    .prepare(
      `UPDATE pi_sites SET last_harvest_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(at, now(), siteId)
}

export function getSite(id: string): PiSiteRow | null {
  const row = sqlite()
    .prepare(`SELECT * FROM pi_sites WHERE id = ?`)
    .get(id) as Record<string, unknown> | null
  return row ? rowToSite(row) : null
}

export function getSiteBySlug(slug: string): PiSiteRow | null {
  const row = sqlite()
    .prepare(
      `SELECT * FROM pi_sites WHERE slug = ? AND status != 'deleted' ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(slug) as Record<string, unknown> | null
  return row ? rowToSite(row) : null
}

export function listSites(
  options: { status?: PiSiteStatus | PiSiteStatus[] } = {},
): PiSiteRow[] {
  const statuses = options.status
    ? Array.isArray(options.status)
      ? options.status
      : [options.status]
    : ['active', 'dormant', 'drafting']
  const rows = sqlite()
    .prepare(
      `SELECT * FROM pi_sites WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY updated_at DESC`,
    )
    .all(...statuses) as Array<Record<string, unknown>>
  return rows.map(rowToSite)
}

export function archiveSite(id: string): void {
  const ts = now()
  sqlite()
    .prepare(
      `UPDATE pi_sites SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?`,
    )
    .run(ts, ts, id)
}

export async function writePageDoc(
  siteId: string | null,
  pageId: string,
  doc: PiPageDoc,
  options: {
    kind?: string
    bucketId?: string
    filePath?: string
  } = {},
): Promise<PiPageRow> {
  const validated = validatePageDoc(doc)
  const ts = now()
  const filePath =
    options.filePath ?? (siteId ? pageFile(siteId, pageId) : tempFile(pageId))
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(validated, null, 2), 'utf-8')

  const existing = getPage(pageId)
  sqlite()
    .prepare(
      `INSERT OR REPLACE INTO pi_pages
        (id, site_id, bucket_id, kind, title, status, file_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      pageId,
      siteId,
      options.bucketId ?? existing?.bucketId ?? 'default',
      options.kind ?? existing?.kind ?? 'entity',
      validated.title,
      existing?.status ?? 'active',
      filePath,
      existing?.createdAt ?? ts,
      ts,
    )
  return getPage(pageId)!
}

function rowToPage(row: Record<string, unknown>): PiPageRow {
  return {
    id: row.id as string,
    siteId: (row.site_id as string | null) ?? null,
    bucketId: row.bucket_id as string,
    kind: row.kind as string,
    title: row.title as string,
    status: row.status as string,
    filePath: row.file_path as string,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function getPage(id: string): PiPageRow | null {
  const row = sqlite()
    .prepare(`SELECT * FROM pi_pages WHERE id = ?`)
    .get(id) as Record<string, unknown> | null
  return row ? rowToPage(row) : null
}

export function listPagesForSite(siteId: string): PiPageRow[] {
  const rows = sqlite()
    .prepare(
      `SELECT * FROM pi_pages WHERE site_id = ? AND status != 'archived' ORDER BY updated_at DESC`,
    )
    .all(siteId) as Array<Record<string, unknown>>
  return rows.map(rowToPage)
}

export async function inspectPageDoc(
  pageId: string,
): Promise<PiPageInspection | null> {
  const page = getPage(pageId)
  if (!page) return null
  return inspectPageFile({
    pageId,
    siteId: page.siteId,
    title: page.title,
    filePath: page.filePath,
  })
}

export async function readPageDoc(pageId: string): Promise<PiPageDoc | null> {
  const inspection = await inspectPageDoc(pageId)
  if (!inspection) return null
  const doc = inspection.doc
  if (!doc) return null
  // Persist heals / auto-repairs when on-disk differs.
  if (inspection.raw != null) {
    const page = getPage(pageId)
    if (page && JSON.stringify(doc) !== JSON.stringify(inspection.raw)) {
      try {
        await writeFile(page.filePath, JSON.stringify(doc, null, 2), 'utf-8')
      } catch {
        // Best-effort heal; still return the validated doc.
      }
    }
  }
  return doc
}

export function upsertRecord(input: {
  id?: string
  siteId: string
  type: string
  data: Record<string, unknown>
  bucketId?: string
  expectedVersion?: number
}): PiRecordRow {
  const ts = now()
  const existing = input.id ? getRecord(input.id) : null
  if (
    existing &&
    input.expectedVersion != null &&
    existing.version !== input.expectedVersion
  ) {
    throw new Error(
      `Record version mismatch: expected ${input.expectedVersion}, got ${existing.version}`,
    )
  }
  const id = existing?.id ?? input.id ?? newPiId('rec')
  const version = existing ? existing.version + 1 : 1
  sqlite()
    .prepare(
      `INSERT OR REPLACE INTO pi_records
        (id, site_id, bucket_id, type, data_json, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.siteId,
      input.bucketId ?? existing?.bucketId ?? 'default',
      input.type,
      JSON.stringify(input.data),
      version,
      existing?.createdAt ?? ts,
      ts,
    )
  return getRecord(id)!
}

function rowToRecord(row: Record<string, unknown>): PiRecordRow {
  return {
    id: row.id as string,
    siteId: row.site_id as string,
    bucketId: row.bucket_id as string,
    type: row.type as string,
    dataJson: row.data_json as string,
    version: row.version as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function getRecord(id: string): PiRecordRow | null {
  const row = sqlite()
    .prepare(`SELECT * FROM pi_records WHERE id = ?`)
    .get(id) as Record<string, unknown> | null
  return row ? rowToRecord(row) : null
}

export function listRecords(siteId: string): PiRecordRow[] {
  const rows = sqlite()
    .prepare(
      `SELECT * FROM pi_records WHERE site_id = ? ORDER BY updated_at DESC`,
    )
    .all(siteId) as Array<Record<string, unknown>>
  return rows.map(rowToRecord)
}

export function upsertPulse(siteId: string, pulse: PiPulse): void {
  const ts = now()
  sqlite()
    .prepare(
      `INSERT OR REPLACE INTO pi_pulses (site_id, pulse_json, stale_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      siteId,
      JSON.stringify(pulse),
      pulse.staleAt ? Date.parse(pulse.staleAt) : null,
      ts,
    )
}

export function getPulse(siteId: string): PiPulse | null {
  const row = sqlite()
    .prepare(`SELECT * FROM pi_pulses WHERE site_id = ?`)
    .get(siteId) as Record<string, unknown> | null
  if (!row) return null
  return JSON.parse(row.pulse_json as string) as PiPulse
}

export function upsertPolicy(
  targetType: string,
  targetId: string,
  policy: PiRefreshPolicy,
): void {
  const id = `${targetType}:${targetId}`
  sqlite()
    .prepare(
      `INSERT OR REPLACE INTO pi_refresh_policies
        (id, target_type, target_id, policy_json, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, targetType, targetId, JSON.stringify(policy), now())
}

export function getPolicy(
  targetType: string,
  targetId: string,
): PiRefreshPolicy | null {
  const row = sqlite()
    .prepare(
      `SELECT policy_json FROM pi_refresh_policies WHERE target_type = ? AND target_id = ?`,
    )
    .get(targetType, targetId) as { policy_json: string } | null
  return row ? (JSON.parse(row.policy_json) as PiRefreshPolicy) : null
}

export async function createTemp(input: {
  id?: string
  title: string
  doc: PiPageDoc
  ttlMs?: number
  bucketId?: string
}): Promise<PiTempRow> {
  const id = input.id ?? newPiId('temp')
  const ts = now()
  const ttl = input.ttlMs ?? 1000 * 60 * 60 * 24
  const filePath = tempFile(id)
  await writePageDoc(null, id, input.doc, {
    kind: 'entity',
    filePath,
    bucketId: input.bucketId,
  })
  sqlite()
    .prepare(
      `INSERT OR REPLACE INTO pi_temps
        (id, bucket_id, title, file_path, status, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .run(
      id,
      input.bucketId ?? 'default',
      input.title,
      filePath,
      ts + ttl,
      ts,
      ts,
    )
  return getTemp(id)!
}

function rowToTemp(row: Record<string, unknown>): PiTempRow {
  return {
    id: row.id as string,
    bucketId: row.bucket_id as string,
    title: row.title as string,
    filePath: row.file_path as string,
    status: row.status as string,
    expiresAt: row.expires_at as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function getTemp(id: string): PiTempRow | null {
  const row = sqlite()
    .prepare(`SELECT * FROM pi_temps WHERE id = ?`)
    .get(id) as Record<string, unknown> | null
  return row ? rowToTemp(row) : null
}

export function listTemps(status: string[] = ['active']): PiTempRow[] {
  const rows = sqlite()
    .prepare(
      `SELECT * FROM pi_temps WHERE status IN (${status.map(() => '?').join(',')}) ORDER BY created_at DESC`,
    )
    .all(...status) as Array<Record<string, unknown>>
  return rows.map(rowToTemp)
}

export async function deleteTemp(id: string): Promise<void> {
  const temp = getTemp(id)
  sqlite().prepare(`DELETE FROM pi_temps WHERE id = ?`).run(id)
  sqlite().prepare(`DELETE FROM pi_pages WHERE id = ?`).run(id)
  if (temp) {
    try {
      await unlink(temp.filePath)
    } catch {
      /* ignore */
    }
  }
}

export type HomePrefs = {
  hiddenSiteIds: string[]
  pinnedSiteIds: string[]
  /** Continuity block ids removed from Today until the next Today refresh. */
  dismissedContinuityIds: string[]
  /** Site ids removed from "Suggest for home" until the site changes again. */
  dismissedProposeIds: string[]
}

const MAX_DISMISSED_CONTINUITY = 50
const MAX_DISMISSED_PROPOSE = 50

export async function readHomePrefs(): Promise<HomePrefs> {
  try {
    const raw = await readFile(homePrefsFile(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<HomePrefs>
    return {
      hiddenSiteIds: parsed.hiddenSiteIds ?? [],
      pinnedSiteIds: parsed.pinnedSiteIds ?? [],
      dismissedContinuityIds: Array.isArray(parsed.dismissedContinuityIds)
        ? parsed.dismissedContinuityIds.filter((id) => typeof id === 'string')
        : [],
      dismissedProposeIds: Array.isArray(parsed.dismissedProposeIds)
        ? parsed.dismissedProposeIds.filter((id) => typeof id === 'string')
        : [],
    }
  } catch {
    return {
      hiddenSiteIds: [],
      pinnedSiteIds: [],
      dismissedContinuityIds: [],
      dismissedProposeIds: [],
    }
  }
}

export async function writeHomePrefs(prefs: HomePrefs): Promise<void> {
  const path = homePrefsFile()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    JSON.stringify(
      {
        hiddenSiteIds: prefs.hiddenSiteIds,
        pinnedSiteIds: prefs.pinnedSiteIds,
        dismissedContinuityIds: prefs.dismissedContinuityIds.slice(
          -MAX_DISMISSED_CONTINUITY,
        ),
        dismissedProposeIds: prefs.dismissedProposeIds.slice(
          -MAX_DISMISSED_PROPOSE,
        ),
      },
      null,
      2,
    ),
    'utf-8',
  )
}

/** Hide a Today block until the next Today refresh. */
export async function dismissContinuityBlock(id: string): Promise<HomePrefs> {
  const trimmed = id.trim()
  if (!trimmed) return readHomePrefs()
  const prefs = await readHomePrefs()
  const dismissed = new Set(prefs.dismissedContinuityIds)
  dismissed.add(trimmed)
  const next: HomePrefs = {
    ...prefs,
    dismissedContinuityIds: [...dismissed].slice(-MAX_DISMISSED_CONTINUITY),
  }
  await writeHomePrefs(next)

  const regions = await readHomeRegions()
  if (regions.continuity.some((c) => c.id === trimmed)) {
    await writeHomeContinuity(
      regions.continuity.filter((c) => c.id !== trimmed),
    )
  }
  return next
}

/** Hide a proposed doorway from "Suggest for home" until the site changes. */
export async function dismissProposedDoorway(
  siteId: string,
): Promise<HomePrefs> {
  const trimmed = siteId.trim()
  if (!trimmed) return readHomePrefs()
  const prefs = await readHomePrefs()
  const dismissed = new Set(prefs.dismissedProposeIds)
  dismissed.add(trimmed)
  const next: HomePrefs = {
    ...prefs,
    dismissedProposeIds: [...dismissed].slice(-MAX_DISMISSED_PROPOSE),
  }
  await writeHomePrefs(next)
  return next
}

/** Hide/unhide/pin/unpin a doorway — shared by the pi_home_regions_patch
 * tool and the /pi/home/doorway/visibility HTTP route so both paths agree. */
export async function updateDoorwayVisibility(input: {
  hideSiteId?: string
  unhideSiteId?: string
  pinSiteId?: string
  unpinSiteId?: string
}): Promise<HomePrefs> {
  const prefs = await readHomePrefs()
  const hidden = new Set(prefs.hiddenSiteIds)
  const pinned = new Set(prefs.pinnedSiteIds)
  if (input.hideSiteId) hidden.add(input.hideSiteId)
  if (input.unhideSiteId) hidden.delete(input.unhideSiteId)
  if (input.pinSiteId) pinned.add(input.pinSiteId)
  if (input.unpinSiteId) pinned.delete(input.unpinSiteId)
  const next: HomePrefs = {
    ...prefs,
    hiddenSiteIds: [...hidden],
    pinnedSiteIds: [...pinned],
  }
  await writeHomePrefs(next)
  return next
}

export async function clearDismissedContinuity(): Promise<void> {
  const prefs = await readHomePrefs()
  if (prefs.dismissedContinuityIds.length === 0) return
  await writeHomePrefs({ ...prefs, dismissedContinuityIds: [] })
}

export type HomeRegionsFile = {
  continuity: PiContinuityBlock[]
}

export async function readHomeRegions(): Promise<HomeRegionsFile> {
  try {
    const raw = await readFile(homeRegionsFile(), 'utf-8')
    const parsed = JSON.parse(raw) as { continuity?: PiContinuityBlock[] }
    const continuity = Array.isArray(parsed.continuity)
      ? parsed.continuity.filter(
          (c) =>
            c &&
            typeof c.id === 'string' &&
            typeof c.title === 'string' &&
            typeof c.body === 'string',
        )
      : []
    return { continuity }
  } catch {
    return { continuity: [] }
  }
}

/** Replace continuity blocks on home (max 5). Empty array clears custom continuity. */
export async function writeHomeContinuity(
  continuity: PiContinuityBlock[],
): Promise<HomeRegionsFile> {
  const next: HomeRegionsFile = {
    continuity: continuity.slice(0, 5).map((c) => ({
      id: c.id,
      title: c.title,
      body: c.body,
      ...(c.route ? { route: c.route } : {}),
      ...(c.agentQuery ? { agentQuery: c.agentQuery } : {}),
      ...(c.metadata ? { metadata: c.metadata } : {}),
    })),
  }
  const path = homeRegionsFile()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export type PiRefreshJobRow = {
  id: string
  targetType: string
  targetId: string
  kind: string
  triggerName: string
  coalesceKey: string
  status: string
  errorText: string | null
  filterValue: string | null
  createdAt: number
  updatedAt: number
}

function rowToJob(row: Record<string, unknown>): PiRefreshJobRow {
  return {
    id: row.id as string,
    targetType: row.target_type as string,
    targetId: row.target_id as string,
    kind: row.kind as string,
    triggerName: row.trigger_name as string,
    coalesceKey: row.coalesce_key as string,
    status: row.status as string,
    errorText: (row.error_text as string | null) ?? null,
    filterValue: (row.filter_value as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function findPendingJobByCoalesce(
  coalesceKey: string,
): PiRefreshJobRow | null {
  const row = sqlite()
    .prepare(
      `SELECT * FROM pi_refresh_jobs
       WHERE coalesce_key = ? AND status IN ('pending', 'running')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(coalesceKey) as Record<string, unknown> | null
  return row ? rowToJob(row) : null
}

export function insertRefreshJob(input: {
  targetType: string
  targetId: string
  kind: string
  triggerName: string
  coalesceKey: string
  filterValue?: string | null
}): PiRefreshJobRow {
  const id = newPiId('rjob')
  const ts = now()
  sqlite()
    .prepare(
      `INSERT INTO pi_refresh_jobs
        (id, target_type, target_id, kind, trigger_name, coalesce_key,
         status, error_text, filter_value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?)`,
    )
    .run(
      id,
      input.targetType,
      input.targetId,
      input.kind,
      input.triggerName,
      input.coalesceKey,
      input.filterValue ?? null,
      ts,
      ts,
    )
  return getRefreshJob(id)!
}

export function getRefreshJob(id: string): PiRefreshJobRow | null {
  const row = sqlite()
    .prepare(`SELECT * FROM pi_refresh_jobs WHERE id = ?`)
    .get(id) as Record<string, unknown> | null
  return row ? rowToJob(row) : null
}

export function listPendingRefreshJobs(limit = 20): PiRefreshJobRow[] {
  const rows = sqlite()
    .prepare(
      `SELECT * FROM pi_refresh_jobs WHERE status = 'pending'
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>
  return rows.map(rowToJob)
}

export function updateRefreshJobStatus(
  id: string,
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped',
  errorText?: string | null,
): void {
  sqlite()
    .prepare(
      `UPDATE pi_refresh_jobs SET status = ?, error_text = ?, updated_at = ? WHERE id = ?`,
    )
    .run(status, errorText ?? null, now(), id)
}

export function cancelPendingJobsForTarget(
  targetType: string,
  targetId: string,
): number {
  const result = sqlite()
    .prepare(
      `UPDATE pi_refresh_jobs SET status = 'skipped', updated_at = ?
       WHERE target_type = ? AND target_id = ? AND status = 'pending'`,
    )
    .run(now(), targetType, targetId)
  return result.changes
}

export function listPolicies(): Array<{
  targetType: string
  targetId: string
  policy: PiRefreshPolicy
}> {
  const rows = sqlite()
    .prepare(
      `SELECT target_type, target_id, policy_json FROM pi_refresh_policies`,
    )
    .all() as Array<{
    target_type: string
    target_id: string
    policy_json: string
  }>
  return rows.map((r) => ({
    targetType: r.target_type,
    targetId: r.target_id,
    policy: JSON.parse(r.policy_json) as PiRefreshPolicy,
  }))
}

export async function deletePage(pageId: string): Promise<void> {
  const page = getPage(pageId)
  if (!page) return
  removePiIndex(pageId, 'pi_page')
  sqlite().prepare(`DELETE FROM pi_pages WHERE id = ?`).run(pageId)
  try {
    await unlink(page.filePath)
  } catch {
    /* ignore */
  }
}

export async function hardDeleteSite(siteId: string): Promise<void> {
  // Remove all search index entries before deleting DB rows.
  removePiSiteIndex(siteId)
  const pages = listPagesForSite(siteId)
  for (const page of pages) {
    await deletePage(page.id)
  }
  sqlite().prepare(`DELETE FROM pi_records WHERE site_id = ?`).run(siteId)
  sqlite().prepare(`DELETE FROM pi_pulses WHERE site_id = ?`).run(siteId)
  sqlite()
    .prepare(
      `DELETE FROM pi_refresh_policies WHERE target_type = 'site' AND target_id = ?`,
    )
    .run(siteId)
  cancelPendingJobsForTarget('site', siteId)
  sqlite().prepare(`DELETE FROM pi_sites WHERE id = ?`).run(siteId)
}

export function listExpiredTemps(nowMs = Date.now()): PiTempRow[] {
  const rows = sqlite()
    .prepare(
      `SELECT * FROM pi_temps WHERE status = 'active' AND expires_at <= ?`,
    )
    .all(nowMs) as Array<Record<string, unknown>>
  return rows.map(rowToTemp)
}

export function markTempExpired(id: string): void {
  sqlite()
    .prepare(
      `UPDATE pi_temps SET status = 'expired', updated_at = ? WHERE id = ?`,
    )
    .run(now(), id)
}

export function touchSite(siteId: string): void {
  sqlite()
    .prepare(`UPDATE pi_sites SET updated_at = ? WHERE id = ?`)
    .run(now(), siteId)
}
