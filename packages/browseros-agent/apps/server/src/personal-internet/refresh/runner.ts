/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Refresh runner — drains pending jobs and executes them by kind:
 *   A. Reproject — cheap local recompute of site pulse (no LLM, no network).
 *   B. Sync      — pull structured API/MCP into store (no calendar yet → no-op).
 *   C. Harvest   — browser-session extraction; enqueues a scheduled_run when
 *                  harvest is enabled, otherwise skips and marks the pulse
 *                  stale. Harvest defaults OFF per site.
 *   D. Revise    — home continuity revise (local merge) or skip for pages.
 *   E. Full task — user-visible scheduled job (owned by Scheduled Tasks → n/a).
 */

import { detectOnBattery, getPauseOnBatteryPref } from '../../context/battery'
import { getDbHandle } from '../../lib/db'
import { logger } from '../../lib/logger'
import { isInQuietHours } from '../../reach/quiet-hours'
import { recomputePulse } from '../pulse'
import { getPulse, getSite, listRecords, newPiId, upsertPulse } from '../store'
import {
  getJob,
  listPendingJobs,
  markJobStatus,
  type PiRefreshJob,
} from './bus'
import { reviseHomeContinuityLocal } from './home-revise'
import { hostMatchesFilter } from './policy'

function sqlite() {
  return getDbHandle().sqlite
}

export type RefreshOutcome =
  | 'reprojected'
  | 'synced'
  | 'harvested'
  | 'revised'
  | 'tasked'
  | 'skipped-stale'
  | 'skipped'

export type RunRefreshOptions = {
  /** Overrides the per-site harvest flag (default false — harvest is opt-in). */
  harvestEnabled?: boolean
  /** Cap on jobs drained in one pass. */
  max?: number
  /** Optional open page hosts for session affinity (e.g. from CDP). */
  openHosts?: string[]
}

export type RefreshRunResult = {
  ran: Array<{ id: string; kind: string; outcome: RefreshOutcome }>
}

function markSiteStale(siteId: string): void {
  const pulse = getPulse(siteId)
  if (!pulse) return
  upsertPulse(siteId, { ...pulse, staleAt: new Date().toISOString() })
}

/** Optional CDP host list provider (wired from main when browser is available).
 * Return `null` when hosts are unknown (skip affinity check).
 * Return `[]` when CDP works and no matching tabs exist.
 */
let openHostsProvider: (() => Promise<string[] | null>) | null = null

export function setHarvestOpenHostsProvider(
  provider: (() => Promise<string[] | null>) | null,
): void {
  openHostsProvider = provider
}

async function harvestGuardsAllow(
  site: NonNullable<ReturnType<typeof getSite>>,
  options: RunRefreshOptions,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (getPauseOnBatteryPref()) {
    const onBattery = await detectOnBattery()
    if (onBattery === true) {
      return { ok: false, reason: 'battery' }
    }
  }
  if (isInQuietHours()) {
    return { ok: false, reason: 'quiet-hours' }
  }
  const host = site.harvestHost
  if (host) {
    let openHosts: string[] | undefined = options.openHosts
    if (openHosts === undefined && openHostsProvider) {
      try {
        const resolved = await openHostsProvider()
        if (resolved != null) openHosts = resolved
      } catch {
        // CDP unknown — do not block harvest
      }
    }
    if (openHosts !== undefined) {
      const matched = openHosts.some((h) => hostMatchesFilter(h, host))
      if (!matched) {
        return { ok: false, reason: 'host-tab-closed' }
      }
    }
  }
  return { ok: true }
}

function buildHarvestPrompt(
  site: NonNullable<ReturnType<typeof getSite>>,
): string {
  const records = listRecords(site.id).map((r) => {
    try {
      return { id: r.id, type: r.type, data: JSON.parse(r.dataJson) }
    } catch {
      return { id: r.id, type: r.type, data: {} }
    }
  })
  return [
    `Harvest ${site.harvestHost ?? 'connected source'} for Personalised Internet site "${site.name}".`,
    `siteId=${site.id}`,
    `harvestHost=${site.harvestHost ?? ''}`,
    '',
    'Current records (do not invent companies not on the host or in vault):',
    JSON.stringify(records.slice(0, 40)),
    '',
    'Instructions:',
    '1. Load skill pi-harvest-job-search if available (skills_load).',
    '2. Navigate the harvest host only when a matching tab/session exists; do not invent pages.',
    '3. Upsert applications via pi_record_upsert (recordType job-application) — board syncs automatically.',
    '4. Prefer pi_record_list to see prior state before writing.',
    '5. If nothing to update, leave records unchanged — never fabricate companies.',
    '6. When done, pulse should reflect real stages.',
  ].join('\n')
}

/** "Easy" harvest path: hand the work to the server run queue, then reproject. */
function enqueueHarvestRun(job: PiRefreshJob): void {
  const site = getSite(job.targetId)
  if (!site) return
  const id = newPiId('run')
  const ts = Date.now()
  sqlite()
    .prepare(
      `INSERT INTO scheduled_runs
        (id, source, source_id, idempotency_key, prompt, bucket_id, status, completed_steps_json, created_at)
       VALUES (?, 'pi-harvest', ?, ?, ?, ?, 'pending', '[]', ?)`,
    )
    .run(
      id,
      site.id,
      `pi-harvest:${site.id}:${ts}`,
      buildHarvestPrompt(site),
      site.bucketId,
      ts,
    )
}

async function runOne(
  job: PiRefreshJob,
  options: RunRefreshOptions,
): Promise<RefreshOutcome> {
  switch (job.kind) {
    case 'A': {
      if (job.targetType === 'site') recomputePulse(job.targetId)
      if (job.targetType === 'home') {
        await reviseHomeContinuityLocal()
      }
      return 'reprojected'
    }
    case 'B': {
      // No structured sync source wired yet — keep last good snapshot.
      return 'synced'
    }
    case 'C': {
      const site = job.targetType === 'site' ? getSite(job.targetId) : null
      const enabled =
        options.harvestEnabled === true || site?.harvestEnabled === 1
      if (!enabled || !site) {
        if (job.targetType === 'site') markSiteStale(job.targetId)
        return 'skipped-stale'
      }
      const guards = await harvestGuardsAllow(site, options)
      if (!guards.ok) {
        markSiteStale(site.id)
        logger.info('pi harvest skipped', {
          siteId: site.id,
          reason: guards.reason,
        })
        return 'skipped-stale'
      }
      enqueueHarvestRun(job)
      return 'harvested'
    }
    case 'D': {
      if (job.targetType === 'home') {
        await reviseHomeContinuityLocal()
        return 'revised'
      }
      if (job.targetType === 'site') {
        const { syncBoardFromRecords, syncChartFromRecords } = await import(
          '../records'
        )
        await syncBoardFromRecords(job.targetId)
        await syncChartFromRecords(job.targetId)
        recomputePulse(job.targetId)
        return 'revised'
      }
      return 'skipped'
    }
    case 'E': {
      return 'skipped'
    }
    default:
      return 'skipped'
  }
}

export async function executeRefreshJob(
  job: PiRefreshJob,
  options: RunRefreshOptions = {},
): Promise<RefreshOutcome> {
  const current = getJob(job.id)
  if (!current || current.status !== 'pending') {
    return 'skipped'
  }
  markJobStatus(job.id, 'running')
  try {
    const outcome = await runOne(current, options)
    markJobStatus(job.id, 'done')
    return outcome
  } catch (err) {
    markJobStatus(
      job.id,
      'error',
      err instanceof Error ? err.message : String(err),
    )
    logger.warn('pi refresh job failed', {
      jobId: job.id,
      kind: job.kind,
      error: err instanceof Error ? err.message : String(err),
    })
    return 'skipped'
  }
}

export async function runRefreshJobs(
  options: RunRefreshOptions = {},
): Promise<RefreshRunResult> {
  const pending = listPendingJobs()
  const jobs = options.max != null ? pending.slice(0, options.max) : pending
  const ran: RefreshRunResult['ran'] = []

  for (const queued of jobs) {
    const outcome = await executeRefreshJob(queued, options)
    ran.push({ id: queued.id, kind: queued.kind, outcome })
  }

  return { ran }
}

/** Alias used by HTTP routes. */
export async function drainRefreshJobs(max = 20): Promise<RefreshRunResult> {
  return runRefreshJobs({ max })
}
