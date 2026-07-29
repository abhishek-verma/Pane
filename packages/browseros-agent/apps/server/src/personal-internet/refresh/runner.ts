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
 *   D. Revise    — agent rewrites page composition (needs a model → deferred).
 *   E. Full task — user-visible scheduled job (owned by Scheduled Tasks → n/a).
 */

import { getDbHandle } from '../../lib/db'
import { logger } from '../../lib/logger'
import { recomputePulse } from '../pulse'
import { getPulse, getSite, newPiId, upsertPulse } from '../store'
import {
  getJob,
  listPendingJobs,
  markJobStatus,
  type PiRefreshJob,
} from './bus'

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
}

export type RefreshRunResult = {
  ran: Array<{ id: string; kind: string; outcome: RefreshOutcome }>
}

function markSiteStale(siteId: string): void {
  const pulse = getPulse(siteId)
  if (!pulse) return
  upsertPulse(siteId, { ...pulse, staleAt: new Date().toISOString() })
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
      `Harvest ${site.harvestHost ?? 'connected source'} for ${site.name} and update its records.`,
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
      // Home reprojects are computed on read; only sites need a pulse recompute.
      if (job.targetType === 'site') recomputePulse(job.targetId)
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
      enqueueHarvestRun(job)
      return 'harvested'
    }
    case 'D': {
      // Page revision needs an LLM; not run inline. Keep last good composition.
      return 'skipped'
    }
    case 'E': {
      // Full user-visible task belongs to Scheduled Tasks, not the refresh bus.
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
