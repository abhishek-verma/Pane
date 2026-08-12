/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Refresh runner — drains pending jobs and executes them by kind:
 *   A. Reproject — cheap local recompute of site pulse (no LLM, no network).
 *   B. Sync      — pull structured API/MCP into store (no calendar yet → no-op).
 *   C. Harvest   — browser/event extraction; enqueues a scheduled_run when
 *                  harvest is enabled, otherwise skips and marks the pulse
 *                  stale. Harvest defaults OFF per site.
 *   D. Revise    — home continuity revise (local merge) or site board sync.
 *   E. Full task — user-visible scheduled job (owned by Scheduled Tasks → n/a).
 */

import { readFileSync } from 'node:fs'
import { detectOnBattery, getPauseOnBatteryPref } from '../../context/battery'
import { getDbHandle } from '../../lib/db'
import { logger } from '../../lib/logger'
import { isInQuietHours } from '../../reach/quiet-hours'
import {
  browserCadenceBucket,
  browserCadenceElapsed,
  buildHarvestPrompt,
  harvestConfigFromSite,
  normalizeHost,
} from '../harvest-config'
import { recomputePulse } from '../pulse'
import {
  getPulse,
  getSite,
  listRecords,
  newPiId,
  setSiteLastHarvestAt,
  upsertPulse,
} from '../store'
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

async function resolveOpenHosts(
  options: RunRefreshOptions,
): Promise<string[] | undefined> {
  if (options.openHosts !== undefined) return options.openHosts
  if (!openHostsProvider) return undefined
  try {
    const resolved = await openHostsProvider()
    return resolved ?? undefined
  } catch {
    return undefined
  }
}

function isMeetingTrigger(triggerName: string): boolean {
  return triggerName === 'meeting-ended'
}

function isBrowserHarvestTrigger(triggerName: string): boolean {
  return triggerName === 'host-opened' || triggerName === 'harvest-due'
}

async function harvestGuardsAllow(
  site: NonNullable<ReturnType<typeof getSite>>,
  job: PiRefreshJob,
  options: RunRefreshOptions,
): Promise<{ ok: true; openHosts?: string[] } | { ok: false; reason: string }> {
  const config = harvestConfigFromSite(site)
  const meeting = isMeetingTrigger(job.triggerName)

  if (meeting) {
    // User just finished a meeting — do not block on quiet hours / battery / tabs.
    return { ok: true }
  }

  if (getPauseOnBatteryPref()) {
    const onBattery = await detectOnBattery()
    if (onBattery === true) {
      return { ok: false, reason: 'battery' }
    }
  }
  if (isInQuietHours()) {
    return { ok: false, reason: 'quiet-hours' }
  }

  if (!browserCadenceElapsed(config)) {
    return { ok: false, reason: 'cadence' }
  }

  const openHosts = await resolveOpenHosts(options)
  const needsOpenTab =
    job.triggerName === 'host-opened' ||
    (job.triggerName === 'harvest-due' && !config.allowNavigate)

  if (needsOpenTab && config.sources.length > 0 && openHosts !== undefined) {
    const matched = config.sources.some((src) =>
      openHosts.some((h) => hostMatchesFilter(normalizeHost(h), src)),
    )
    if (!matched) {
      return { ok: false, reason: 'host-tab-closed' }
    }
  }

  return { ok: true, openHosts }
}

function findScheduledRunByKey(idempotencyKey: string): {
  id: string
  status: string
} | null {
  const row = sqlite()
    .prepare(
      `SELECT id, status FROM scheduled_runs WHERE idempotency_key = ? LIMIT 1`,
    )
    .get(idempotencyKey) as { id: string; status: string } | null
  return row ?? null
}

function hasPendingBrowserHarvest(siteId: string): boolean {
  const row = sqlite()
    .prepare(
      `SELECT id FROM scheduled_runs
       WHERE source = 'pi-harvest' AND source_id = ?
         AND status IN ('pending', 'running')
         AND idempotency_key NOT LIKE '%:meeting:%'
       LIMIT 1`,
    )
    .get(siteId) as { id: string } | null
  return !!row
}

function loadMeetingTranscript(sessionId: string | null | undefined): {
  path: string | null
  excerpt: string | null
} {
  if (!sessionId) return { path: null, excerpt: null }
  try {
    const row = sqlite()
      .prepare(
        `SELECT transcript_path, summary_path FROM capture_sessions WHERE id = ?`,
      )
      .get(sessionId) as {
      transcript_path: string | null
      summary_path: string | null
    } | null
    if (!row) return { path: null, excerpt: null }
    const path = row.summary_path ?? row.transcript_path
    if (!path) return { path: null, excerpt: null }
    try {
      const text = readFileSync(path, 'utf-8')
      return { path, excerpt: text.slice(0, 6000) }
    } catch {
      return { path, excerpt: null }
    }
  } catch {
    return { path: null, excerpt: null }
  }
}

/** Exported for tests — builds the structured harvest prompt. */
export function buildHarvestPromptForJob(
  site: NonNullable<ReturnType<typeof getSite>>,
  job: PiRefreshJob,
  openHosts?: string[],
): string {
  const meeting = isMeetingTrigger(job.triggerName)
  const transcript = meeting
    ? loadMeetingTranscript(job.filterValue)
    : { path: null, excerpt: null }
  const records = listRecords(site.id).map((r) => {
    try {
      return {
        id: r.id,
        type: r.type,
        data: JSON.parse(r.dataJson) as Record<string, unknown>,
      }
    } catch {
      return { id: r.id, type: r.type, data: {} as Record<string, unknown> }
    }
  })
  return buildHarvestPrompt({
    site,
    triggerName: job.triggerName,
    filterValue: job.filterValue,
    transcriptExcerpt: transcript.excerpt,
    transcriptPath: transcript.path,
    openHosts: openHosts ?? null,
    records,
  })
}

/** "Easy" harvest path: hand the work to the server run queue, then reproject. */
function enqueueHarvestRun(
  job: PiRefreshJob,
  openHosts?: string[],
): 'harvested' | 'skipped-stale' {
  const site = getSite(job.targetId)
  if (!site) return 'skipped-stale'
  const config = harvestConfigFromSite(site)
  const meeting = isMeetingTrigger(job.triggerName)
  const ts = Date.now()

  let idempotencyKey: string
  if (meeting) {
    const sessionId = job.filterValue ?? 'unknown'
    idempotencyKey = `pi-harvest:${site.id}:meeting:${sessionId}`
  } else {
    if (hasPendingBrowserHarvest(site.id)) {
      logger.info('pi harvest coalesced', {
        siteId: site.id,
        reason: 'pending',
      })
      return 'skipped-stale'
    }
    idempotencyKey = `pi-harvest:${site.id}:${browserCadenceBucket(config, ts)}`
  }

  const existing = findScheduledRunByKey(idempotencyKey)
  if (existing) {
    logger.info('pi harvest idempotent skip', {
      siteId: site.id,
      key: idempotencyKey,
      status: existing.status,
    })
    return 'skipped-stale'
  }

  const prompt = buildHarvestPromptForJob(site, job, openHosts)
  const id = newPiId('run')
  sqlite()
    .prepare(
      `INSERT INTO scheduled_runs
        (id, source, source_id, idempotency_key, prompt, bucket_id, status, completed_steps_json, created_at)
       VALUES (?, 'pi-harvest', ?, ?, ?, ?, 'pending', '[]', ?)`,
    )
    .run(id, site.id, idempotencyKey, prompt, site.bucketId, ts)

  if (isBrowserHarvestTrigger(job.triggerName)) {
    setSiteLastHarvestAt(site.id, ts)
  }

  return 'harvested'
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
      const guards = await harvestGuardsAllow(site, job, options)
      if (!guards.ok) {
        markSiteStale(site.id)
        logger.info('pi harvest skipped', {
          siteId: site.id,
          reason: guards.reason,
          trigger: job.triggerName,
        })
        return 'skipped-stale'
      }
      return enqueueHarvestRun(job, guards.openHosts)
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
        const { emitPiEvent } = await import('../events')
        emitPiEvent('site-updated', { siteId: job.targetId })
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
  if (current?.status !== 'pending') {
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
