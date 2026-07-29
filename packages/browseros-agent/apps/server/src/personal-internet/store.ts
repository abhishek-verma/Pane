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
import { removePiIndex, removePiSiteIndex } from './index-pi'
import { homePrefsFile, pageFile, siteManifestFile, tempFile } from './paths'
import type { PiPageDoc, PiPulse, PiRefreshPolicy, PiSiteStatus } from './types'

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
  doorwayEligible?: boolean
  bucketId?: string
}

export async function upsertSite(input: UpsertSiteInput): Promise<PiSiteRow> {
  const ts = now()
  const existing = input.id ? getSite(input.id) : getSiteBySlug(input.slug)
  const id = existing?.id ?? input.id ?? newPiId('site')
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
    harvest_host:
      input.harvestHost === undefined
        ? (existing?.harvestHost ?? null)
        : input.harvestHost,
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
         harvest_host, doorway_eligible, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  return {
    id: row.id as string,
    bucketId: row.bucket_id as string,
    name: row.name as string,
    slug: row.slug as string,
    jtbd: row.jtbd as string,
    status: row.status as string,
    templateId: (row.template_id as string | null) ?? null,
    harvestEnabled: row.harvest_enabled as number,
    harvestHost: (row.harvest_host as string | null) ?? null,
    doorwayEligible: row.doorway_eligible as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    archivedAt: (row.archived_at as number | null) ?? null,
  }
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

export async function readPageDoc(pageId: string): Promise<PiPageDoc | null> {
  const page = getPage(pageId)
  if (!page) return null
  try {
    const raw = await readFile(page.filePath, 'utf-8')
    return validatePageDoc(JSON.parse(raw))
  } catch {
    return null
  }
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
}

export async function readHomePrefs(): Promise<HomePrefs> {
  try {
    const raw = await readFile(homePrefsFile(), 'utf-8')
    const parsed = JSON.parse(raw) as HomePrefs
    return {
      hiddenSiteIds: parsed.hiddenSiteIds ?? [],
      pinnedSiteIds: parsed.pinnedSiteIds ?? [],
    }
  } catch {
    return { hiddenSiteIds: [], pinnedSiteIds: [] }
  }
}

export async function writeHomePrefs(prefs: HomePrefs): Promise<void> {
  const path = homePrefsFile()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(prefs, null, 2), 'utf-8')
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
}): PiRefreshJobRow {
  const id = newPiId('rjob')
  const ts = now()
  sqlite()
    .prepare(
      `INSERT INTO pi_refresh_jobs
        (id, target_type, target_id, kind, trigger_name, coalesce_key,
         status, error_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
    )
    .run(
      id,
      input.targetType,
      input.targetId,
      input.kind,
      input.triggerName,
      input.coalesceKey,
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
