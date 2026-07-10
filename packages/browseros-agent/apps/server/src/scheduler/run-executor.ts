/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { eq, inArray } from 'drizzle-orm'
import { getDb, getDbHandle } from '../lib/db'
import {
  type ScheduledRunRow,
  scheduledRuns,
} from '../lib/db/schema/scheduled-runs'
import { logger } from '../lib/logger'
import type {
  CompletedStep,
  RunExecutor,
  RunStatus,
  ScheduledRunRecord,
  StartRunInput,
} from './types'

/** Running runs older than this are reclaimed to pending for retry. */
export const STALE_RUNNING_MS = 10 * 60 * 1000

function newRunId(): string {
  return `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

function parseSteps(json: string): CompletedStep[] {
  try {
    return JSON.parse(json) as CompletedStep[]
  } catch {
    return []
  }
}

function rowToRecord(row: ScheduledRunRow): ScheduledRunRecord {
  return {
    id: row.id,
    source: row.source as ScheduledRunRecord['source'],
    sourceId: row.sourceId,
    idempotencyKey: row.idempotencyKey,
    prompt: row.prompt,
    bucketId: row.bucketId,
    status: row.status as ScheduledRunRecord['status'],
    completedSteps: parseSteps(row.completedStepsJson),
    conversationId: row.conversationId,
    result: row.result,
    error: row.error,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  }
}

export function getScheduledRun(id: string): ScheduledRunRecord | null {
  const row = getDb()
    .select()
    .from(scheduledRuns)
    .where(eq(scheduledRuns.id, id))
    .get()
  return row ? rowToRecord(row) : null
}

export function listScheduledRuns(options?: {
  status?: RunStatus | RunStatus[]
  limit?: number
}): ScheduledRunRecord[] {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200)
  const statuses = options?.status
    ? Array.isArray(options.status)
      ? options.status
      : [options.status]
    : null

  let rows: ScheduledRunRow[]
  if (statuses && statuses.length > 0) {
    rows = getDb()
      .select()
      .from(scheduledRuns)
      .where(inArray(scheduledRuns.status, statuses))
      .orderBy(scheduledRuns.createdAt)
      .limit(limit)
      .all()
  } else {
    rows = getDb()
      .select()
      .from(scheduledRuns)
      .orderBy(scheduledRuns.createdAt)
      .limit(limit)
      .all()
  }
  return rows.map(rowToRecord)
}

/** Atomically claim a pending run for execution (pending → running). */
export function claimScheduledRun(id: string): ScheduledRunRecord | null {
  const now = Date.now()
  const result = getDbHandle()
    .sqlite.prepare(
      `UPDATE scheduled_runs SET status = ?, started_at = ? WHERE id = ? AND status = ?`,
    )
    .run('running', now, id, 'pending')
  if (result.changes === 0) return null
  const claimed = getScheduledRun(id)
  return claimed?.status === 'running' ? claimed : null
}

/**
 * Reclaim stale `running` rows back to `pending` so a killed drain can retry.
 * Preserves `completedSteps` for gate idempotency on resume.
 */
export function reclaimStaleRunningRuns(
  olderThanMs: number = STALE_RUNNING_MS,
): number {
  const cutoff = Date.now() - olderThanMs
  const result = getDbHandle()
    .sqlite.prepare(
      `UPDATE scheduled_runs SET status = ?, started_at = NULL
       WHERE status = ? AND started_at IS NOT NULL AND started_at < ?`,
    )
    .run('pending', 'running', cutoff)
  if (result.changes > 0) {
    logger.info('reclaimed stale running scheduled_runs', {
      count: result.changes,
      olderThanMs,
    })
  }
  return result.changes
}

export function completeScheduledRun(
  id: string,
  outcome: {
    status: 'completed' | 'failed' | 'cancelled' | 'skipped'
    result?: string | null
    error?: string | null
    conversationId?: string | null
  },
): ScheduledRunRecord | null {
  const existing = getScheduledRun(id)
  if (!existing) return null
  if (existing.status !== 'running') return null
  const now = Date.now()
  return updateRunStatus(id, {
    status: outcome.status,
    result: outcome.result ?? existing.result,
    error: outcome.error ?? null,
    conversationId:
      outcome.conversationId !== undefined
        ? outcome.conversationId
        : existing.conversationId,
    completedAt: now,
    startedAt: existing.startedAt ?? now,
  })
}

export function findRunByIdempotencyKey(
  key: string,
): ScheduledRunRecord | null {
  const row = getDb()
    .select()
    .from(scheduledRuns)
    .where(eq(scheduledRuns.idempotencyKey, key))
    .get()
  return row ? rowToRecord(row) : null
}

export function appendCompletedStep(
  runId: string,
  step: CompletedStep,
): ScheduledRunRecord | null {
  const existing = getScheduledRun(runId)
  if (!existing) return null
  if (existing.completedSteps.some((s) => s.fingerprint === step.fingerprint)) {
    return existing
  }
  const completedSteps = [...existing.completedSteps, step]
  getDb()
    .update(scheduledRuns)
    .set({ completedStepsJson: JSON.stringify(completedSteps) })
    .where(eq(scheduledRuns.id, runId))
    .run()
  return { ...existing, completedSteps }
}

export function updateRunStatus(
  runId: string,
  patch: Partial<
    Pick<
      ScheduledRunRecord,
      | 'status'
      | 'result'
      | 'error'
      | 'conversationId'
      | 'startedAt'
      | 'completedAt'
    >
  >,
): ScheduledRunRecord | null {
  const existing = getScheduledRun(runId)
  if (!existing) return null
  getDb()
    .update(scheduledRuns)
    .set({
      status: patch.status ?? existing.status,
      result: patch.result !== undefined ? patch.result : existing.result,
      error: patch.error !== undefined ? patch.error : existing.error,
      conversationId:
        patch.conversationId !== undefined
          ? patch.conversationId
          : existing.conversationId,
      startedAt:
        patch.startedAt !== undefined ? patch.startedAt : existing.startedAt,
      completedAt:
        patch.completedAt !== undefined
          ? patch.completedAt
          : existing.completedAt,
    })
    .where(eq(scheduledRuns.id, runId))
    .run()
  return getScheduledRun(runId)
}

/**
 * Creates a run record. Does not call the agent loop yet — callers
 * (or a later chat POST) drive execution. Idempotent on key: returns
 * the existing record if one already exists for the key.
 */
export function createRunRecord(input: StartRunInput): ScheduledRunRecord {
  const existing = findRunByIdempotencyKey(input.idempotencyKey)
  if (existing) return existing

  const now = Date.now()
  const row: ScheduledRunRow = {
    id: newRunId(),
    source: input.source,
    sourceId: input.sourceId ?? null,
    idempotencyKey: input.idempotencyKey,
    prompt: input.prompt,
    bucketId: input.bucketId ?? null,
    status: 'pending',
    completedStepsJson: '[]',
    conversationId: null,
    result: null,
    error: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
  }
  getDb().insert(scheduledRuns).values(row).run()
  return rowToRecord(row)
}

let injectedExecutor: RunExecutor | null = null

/** Test hook — replace the default executor. */
export function setRunExecutor(executor: RunExecutor | null): void {
  injectedExecutor = executor
}

/**
 * Default executor: persist a run record and mark it pending.
 * Full agent execution is driven by the app (chrome.alarms → /chat)
 * or by keep-alive callers that POST /chat with the run's prompt.
 * Trigger engine uses this so graph events never block ingest.
 */
export const defaultRunExecutor: RunExecutor = async (input) => {
  const record = createRunRecord(input)
  logger.info('scheduler run enqueued', {
    runId: record.id,
    source: input.source,
    sourceId: input.sourceId,
    unattended: input.unattended ?? false,
  })
  return record
}

export async function executeRun(
  input: StartRunInput,
): Promise<ScheduledRunRecord> {
  const executor = injectedExecutor ?? defaultRunExecutor
  return executor(input)
}

/** Fingerprint for consequential step dedupe (M5.6). */
export function stepFingerprint(
  toolName: string,
  args: Record<string, unknown>,
  idempotencyKey: string,
): string {
  const stable = JSON.stringify({
    toolName,
    args: canonicalize(args),
    idempotencyKey,
  })
  return `fp_${simpleHash(stable)}`
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      if (key === '__promoted') continue
      out[key] = canonicalize(obj[key])
    }
    return out
  }
  return value
}

function simpleHash(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function shouldSkipCompletedStep(
  run: ScheduledRunRecord,
  fingerprint: string,
  consequenceClass: string,
): boolean {
  const hit = run.completedSteps.find((s) => s.fingerprint === fingerprint)
  if (!hit) return false
  // Consequential classes must never re-execute.
  if (
    consequenceClass === 'write-external' ||
    consequenceClass === 'spend' ||
    consequenceClass === 'system'
  ) {
    return true
  }
  // Read-only may re-run; still skip if already recorded to keep resume cheap.
  return true
}
