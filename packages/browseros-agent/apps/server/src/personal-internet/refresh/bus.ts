/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Refresh bus — enqueue + coalesce page refresh jobs and fan a trigger out to
 * the pages that declared it. Jobs are cheap SQLite rows in `pi_refresh_jobs`;
 * the runner drains them by priority.
 */

import { getDbHandle } from '../../lib/db'
import {
  buildHarvestPolicy,
  harvestConfigFromSite,
  normalizeHost,
} from '../harvest-config'
import { getSite, listSites, newPiId, upsertPolicy } from '../store'
import type { PiRefreshKind } from '../types'
import { setAfterMutationHook } from '../write-path'
import {
  HOME_TARGET_ID,
  homePolicy,
  hostMatchesFilter,
  matchTriggers,
  resolveSitePolicy,
  triggerPriority,
} from './policy'

function sqlite() {
  return getDbHandle().sqlite
}

function now() {
  return Date.now()
}

export type RefreshTargetType = 'site' | 'page' | 'home'

export type RefreshJobStatus = 'pending' | 'running' | 'done' | 'error'

export type PiRefreshJob = {
  id: string
  targetType: RefreshTargetType
  targetId: string
  kind: PiRefreshKind
  triggerName: string
  coalesceKey: string
  status: RefreshJobStatus
  errorText: string | null
  filterValue: string | null
  createdAt: number
  updatedAt: number
}

export type EnqueueRefreshInput = {
  targetType: RefreshTargetType
  targetId: string
  kind: PiRefreshKind
  /** Preferred name. */
  triggerName?: string
  /** Alias used by tests / HTTP. */
  trigger?: string
  /** Reserved for future cooldown windows (pending coalesce covers v1). */
  cooldownMs?: number
  /** Event payload (opened host, meeting session id, …). */
  filterValue?: string | null
}

export function coalesceKeyFor(input: {
  targetType: RefreshTargetType
  targetId: string
  kind: PiRefreshKind
  triggerName?: string
  filterValue?: string | null
}): string {
  if (
    input.kind === 'C' &&
    input.triggerName === 'meeting-ended' &&
    input.filterValue
  ) {
    return `${input.targetType}:${input.targetId}:C:meeting:${input.filterValue}`
  }
  if (input.kind === 'C') {
    return `${input.targetType}:${input.targetId}:C:browser`
  }
  return `${input.targetType}:${input.targetId}:${input.kind}`
}

function rowToJob(row: Record<string, unknown>): PiRefreshJob {
  return {
    id: row.id as string,
    targetType: row.target_type as RefreshTargetType,
    targetId: row.target_id as string,
    kind: row.kind as PiRefreshKind,
    triggerName: row.trigger_name as string,
    coalesceKey: row.coalesce_key as string,
    status: row.status as RefreshJobStatus,
    errorText: (row.error_text as string | null) ?? null,
    filterValue: (row.filter_value as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

/**
 * Enqueue a refresh job. Coalesces: a pending job with the same
 * coalesce key is reused rather than duplicated. Higher-priority triggers
 * upgrade the pending job's trigger name.
 */
export function enqueueRefresh(input: EnqueueRefreshInput): PiRefreshJob {
  const triggerName = input.triggerName ?? input.trigger ?? 'manual-refresh'
  const coalesceKey = coalesceKeyFor({
    targetType: input.targetType,
    targetId: input.targetId,
    kind: input.kind,
    triggerName,
    filterValue: input.filterValue,
  })
  const existing = sqlite()
    .prepare(
      `SELECT * FROM pi_refresh_jobs
       WHERE coalesce_key = ? AND status IN ('pending', 'running')
       LIMIT 1`,
    )
    .get(coalesceKey) as Record<string, unknown> | null

  if (existing) {
    const job = rowToJob(existing)
    if (job.status === 'running') {
      return job
    }
    const nextPri = triggerPriority(triggerName, input.kind)
    const curPri = triggerPriority(job.triggerName, job.kind)
    if (nextPri < curPri) {
      sqlite()
        .prepare(
          `UPDATE pi_refresh_jobs SET trigger_name = ?, filter_value = ?, updated_at = ? WHERE id = ?`,
        )
        .run(triggerName, input.filterValue ?? null, now(), job.id)
      return {
        ...job,
        triggerName,
        filterValue: input.filterValue ?? null,
        updatedAt: now(),
      }
    }
    return job
  }

  const id = newPiId('job')
  const ts = now()
  sqlite()
    .prepare(
      `INSERT INTO pi_refresh_jobs
        (id, target_type, target_id, kind, trigger_name, coalesce_key, status, error_text, filter_value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?)`,
    )
    .run(
      id,
      input.targetType,
      input.targetId,
      input.kind,
      triggerName,
      coalesceKey,
      input.filterValue ?? null,
      ts,
      ts,
    )
  return getJob(id)!
}

/** Pending jobs, ordered by priority then age (oldest first within a tier). */
export function listPendingJobs(): PiRefreshJob[] {
  const rows = sqlite()
    .prepare(`SELECT * FROM pi_refresh_jobs WHERE status = 'pending'`)
    .all() as Array<Record<string, unknown>>
  return rows.map(rowToJob).sort((a, b) => {
    const pa = triggerPriority(a.triggerName, a.kind)
    const pb = triggerPriority(b.triggerName, b.kind)
    if (pa !== pb) return pa - pb
    return a.createdAt - b.createdAt
  })
}

export function getJob(id: string): PiRefreshJob | null {
  const row = sqlite()
    .prepare(`SELECT * FROM pi_refresh_jobs WHERE id = ?`)
    .get(id) as Record<string, unknown> | null
  return row ? rowToJob(row) : null
}

export function markJobStatus(
  id: string,
  status: RefreshJobStatus,
  errorText?: string | null,
): void {
  sqlite()
    .prepare(
      `UPDATE pi_refresh_jobs SET status = ?, error_text = ?, updated_at = ? WHERE id = ?`,
    )
    .run(status, errorText ?? null, now(), id)
}

export type DispatchTriggerInput = {
  triggerName: string
  /** When set, only this site's policy is evaluated. */
  siteId?: string
  /** Filter payload (e.g. the opened host for `host-opened`). */
  filterValue?: string
  /** Skip the always-on home projection reproject. */
  skipHome?: boolean
}

function shouldSkipKind(
  siteId: string | undefined,
  kind: PiRefreshKind,
  policy: ReturnType<typeof resolveSitePolicy>,
): boolean {
  if (kind !== 'C') return false
  if (!policy.guards?.requireHarvestEnabled) return false
  if (!siteId) return true
  const site = getSite(siteId)
  return !site || !site.harvestEnabled
}

/** Keep stored policy aligned with harvest flags (covers migrated sites). */
function syncHarvestPolicy(siteId: string): void {
  const site = getSite(siteId)
  if (!site) return
  upsertPolicy('site', siteId, buildHarvestPolicy(harvestConfigFromSite(site)))
}

function enqueueSiteKinds(
  siteId: string,
  triggerName: string,
  filterValue?: string,
): PiRefreshJob[] {
  const jobs: PiRefreshJob[] = []
  if (
    triggerName === 'host-opened' ||
    triggerName === 'harvest-due' ||
    triggerName === 'meeting-ended'
  ) {
    syncHarvestPolicy(siteId)
  }
  const policy = resolveSitePolicy(siteId)
  for (const kind of matchTriggers(policy, triggerName, filterValue)) {
    if (shouldSkipKind(siteId, kind, policy)) continue
    jobs.push(
      enqueueRefresh({
        targetType: 'site',
        targetId: siteId,
        kind,
        triggerName,
        filterValue,
      }),
    )
  }
  return jobs
}

/**
 * Fan a trigger out to the pages that declared it and enqueue their jobs.
 * Returns the (coalesced) jobs. Site + home are the v1 targets.
 */
export function dispatchTrigger(input: DispatchTriggerInput): PiRefreshJob[] {
  const jobs: PiRefreshJob[] = []

  if (input.siteId) {
    jobs.push(
      ...enqueueSiteKinds(input.siteId, input.triggerName, input.filterValue),
    )
  } else if (input.triggerName === 'host-opened' && input.filterValue) {
    const opened = normalizeHost(input.filterValue)
    for (const site of listSites({ status: ['active', 'dormant'] })) {
      const config = harvestConfigFromSite(site)
      if (
        !config.enabled ||
        !config.onHostOpened ||
        config.sources.length === 0
      ) {
        continue
      }
      const matched = config.sources.some((src) =>
        hostMatchesFilter(opened, src),
      )
      if (!matched) continue
      jobs.push(...enqueueSiteKinds(site.id, 'host-opened', opened))
    }
  } else if (input.triggerName === 'harvest-due') {
    for (const site of listSites({ status: ['active', 'dormant'] })) {
      const config = harvestConfigFromSite(site)
      if (!config.enabled || config.sources.length === 0) continue
      jobs.push(...enqueueSiteKinds(site.id, 'harvest-due'))
    }
  } else if (input.triggerName === 'meeting-ended') {
    for (const site of listSites({ status: ['active', 'dormant'] })) {
      const config = harvestConfigFromSite(site)
      if (!config.enabled || !config.fromMeetings) continue
      jobs.push(
        ...enqueueSiteKinds(site.id, 'meeting-ended', input.filterValue),
      )
    }
  }

  if (!input.skipHome) {
    for (const kind of matchTriggers(homePolicy(), input.triggerName)) {
      jobs.push(
        enqueueRefresh({
          targetType: 'home',
          targetId: HOME_TARGET_ID,
          kind,
          triggerName: input.triggerName,
          filterValue: input.filterValue,
        }),
      )
    }
  }

  return jobs
}

/** HTTP / test helper — fan out a named trigger. */
export function handleRefreshTrigger(input: {
  trigger: string
  siteId?: string
}): PiRefreshJob[] {
  return dispatchTrigger({
    triggerName: input.trigger,
    siteId: input.siteId,
  })
}

/** Host-opened harvest path (kind C gated by harvestEnabled). */
const HOST_OPENED_COOLDOWN_MS = 30_000
const lastHostOpenedAt = new Map<string, number>()

export function handleHostOpened(host: string): PiRefreshJob[] {
  const normalized = normalizeHost(host)
  if (!normalized) return []
  const nowMs = Date.now()
  const last = lastHostOpenedAt.get(normalized) ?? 0
  if (nowMs - last < HOST_OPENED_COOLDOWN_MS) return []
  lastHostOpenedAt.set(normalized, nowMs)
  return dispatchTrigger({
    triggerName: 'host-opened',
    filterValue: normalized,
    skipHome: true,
  })
}

/** Test helper — clear in-memory cooldowns. */
export function clearRefreshCoalesceState(): void {
  lastHostOpenedAt.clear()
}

let hookInstalled = false

/**
 * Wire the write-path so every site mutation enqueues a `site-updated`
 * reproject (kind A) for the site and home. Idempotent.
 */
export function wireRefreshBus(): void {
  if (hookInstalled) return
  hookInstalled = true
  setAfterMutationHook((siteId?: string) => {
    try {
      dispatchTrigger({ triggerName: 'site-updated', siteId })
    } catch {
      // Never let refresh bookkeeping break a write.
    }
  })
}

export function unwireRefreshBus(): void {
  if (!hookInstalled) return
  hookInstalled = false
  setAfterMutationHook(null)
}

export function resetRefreshBusWiringForTests(): void {
  unwireRefreshBus()
}
