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
import { getSite, listSites, newPiId } from '../store'
import type { PiRefreshKind } from '../types'
import { setAfterMutationHook } from '../write-path'
import {
  HOME_TARGET_ID,
  homePolicy,
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
}

export function coalesceKeyFor(input: {
  targetType: RefreshTargetType
  targetId: string
  kind: PiRefreshKind
}): string {
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
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

/**
 * Enqueue a refresh job. Coalesces: a pending job with the same
 * target+kind is reused rather than duplicated. Higher-priority triggers
 * upgrade the pending job's trigger name.
 */
export function enqueueRefresh(input: EnqueueRefreshInput): PiRefreshJob {
  const triggerName = input.triggerName ?? input.trigger ?? 'manual-refresh'
  const coalesceKey = coalesceKeyFor(input)
  const existing = sqlite()
    .prepare(
      `SELECT * FROM pi_refresh_jobs WHERE coalesce_key = ? AND status = 'pending' LIMIT 1`,
    )
    .get(coalesceKey) as Record<string, unknown> | null

  if (existing) {
    const job = rowToJob(existing)
    const nextPri = triggerPriority(triggerName, input.kind)
    const curPri = triggerPriority(job.triggerName, job.kind)
    if (nextPri < curPri) {
      sqlite()
        .prepare(
          `UPDATE pi_refresh_jobs SET trigger_name = ?, updated_at = ? WHERE id = ?`,
        )
        .run(triggerName, now(), job.id)
      return { ...job, triggerName, updatedAt: now() }
    }
    return job
  }

  const id = newPiId('job')
  const ts = now()
  sqlite()
    .prepare(
      `INSERT INTO pi_refresh_jobs
        (id, target_type, target_id, kind, trigger_name, coalesce_key, status, error_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
    )
    .run(
      id,
      input.targetType,
      input.targetId,
      input.kind,
      triggerName,
      coalesceKey,
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

/**
 * Fan a trigger out to the pages that declared it and enqueue their jobs.
 * Returns the (coalesced) jobs. Site + home are the v1 targets.
 */
export function dispatchTrigger(input: DispatchTriggerInput): PiRefreshJob[] {
  const jobs: PiRefreshJob[] = []

  if (input.siteId) {
    const policy = resolveSitePolicy(input.siteId)
    for (const kind of matchTriggers(
      policy,
      input.triggerName,
      input.filterValue,
    )) {
      if (shouldSkipKind(input.siteId, kind, policy)) continue
      jobs.push(
        enqueueRefresh({
          targetType: 'site',
          targetId: input.siteId,
          kind,
          triggerName: input.triggerName,
        }),
      )
    }
  } else if (input.triggerName === 'host-opened' && input.filterValue) {
    for (const site of listSites({ status: ['active', 'dormant'] })) {
      if (!site.harvestHost) continue
      const policy = resolveSitePolicy(site.id)
      for (const kind of matchTriggers(
        policy,
        'host-opened',
        input.filterValue,
      )) {
        if (shouldSkipKind(site.id, kind, policy)) continue
        jobs.push(
          enqueueRefresh({
            targetType: 'site',
            targetId: site.id,
            kind,
            triggerName: 'host-opened',
          }),
        )
      }
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
export function handleHostOpened(host: string): PiRefreshJob[] {
  return dispatchTrigger({
    triggerName: 'host-opened',
    filterValue: host,
    skipHome: true,
  })
}

/** Test helper — no-op for v1 (coalesce is SQLite pending-only). */
export function clearRefreshCoalesceState(): void {
  /* reserved for cooldown map */
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
  hookInstalled = false
  setAfterMutationHook(null)
}

export function resetRefreshBusWiringForTests(): void {
  unwireRefreshBus()
}
