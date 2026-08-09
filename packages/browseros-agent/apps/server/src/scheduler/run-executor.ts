/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { eq, inArray } from 'drizzle-orm'
import { conversationTurnRegistry } from '../agent/conversation-turn-registry'
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

/** Most recent scheduled run linked to a chat conversation (background agent). */
export function findScheduledRunByConversationId(
  conversationId: string,
): ScheduledRunRecord | null {
  const rows = getDb()
    .select()
    .from(scheduledRuns)
    .where(eq(scheduledRuns.conversationId, conversationId))
    .all()
  if (rows.length === 0) return null
  rows.sort((a, b) => b.createdAt - a.createdAt)
  return rowToRecord(rows[0]!)
}

/** Map conversationId → latest scheduled run source for history enrichment. */
export function mapBackgroundSourcesByConversationIds(
  conversationIds: string[],
): Map<string, string> {
  const out = new Map<string, string>()
  if (conversationIds.length === 0) return out
  const idSet = new Set(conversationIds)
  const rows = getDb().select().from(scheduledRuns).all()
  // Prefer newest run per conversation.
  rows.sort((a, b) => b.createdAt - a.createdAt)
  for (const row of rows) {
    if (!row.conversationId || !idSet.has(row.conversationId)) continue
    if (out.has(row.conversationId)) continue
    out.set(row.conversationId, row.source)
  }
  return out
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
 * Preserves `completedSteps` for gate idempotency on resume. Cancels each
 * row's chat turn first — otherwise the abandoned turn keeps running under
 * the old conversationId while the redrain starts an identical-prompt turn
 * under a new one (the exact split-brain pattern split-brain detection in
 * chat-turns-store.ts cannot see, since it only looks within one turn's own
 * conversationId).
 */
export function reclaimStaleRunningRuns(
  olderThanMs: number = STALE_RUNNING_MS,
): number {
  const cutoff = Date.now() - olderThanMs
  const staleRows = getDbHandle()
    .sqlite.prepare(
      `SELECT id, conversation_id FROM scheduled_runs
       WHERE status = ? AND started_at IS NOT NULL AND started_at < ?`,
    )
    .all('running', cutoff) as Array<{
    id: string
    conversation_id: string | null
  }>

  for (const row of staleRows) {
    if (!row.conversation_id) continue
    conversationTurnRegistry.cancelActiveFor(
      row.conversation_id,
      'scheduled-run-reclaimed',
    )
  }

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
      cancelledTurns: staleRows.filter((r) => r.conversation_id).length,
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
  const updated = updateRunStatus(id, {
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
  if (
    existing.source === 'pi-materialize' &&
    (outcome.status === 'completed' || outcome.status === 'failed')
  ) {
    // Prefer sourceId (= pageId). Fall back to parsing the idempotency key,
    // stripping an optional trailing :r<ts> retry suffix.
    let pageId = existing.sourceId
    if (!pageId) {
      const parts = existing.idempotencyKey.split(':')
      if (parts.length >= 4) {
        const rest = parts.slice(3)
        if (rest.length >= 2 && /^r\d+$/.test(rest[rest.length - 1] ?? '')) {
          pageId = rest.slice(0, -1).join(':')
        } else {
          pageId = rest.join(':')
        }
      }
    }
    if (pageId) {
      void import('../personal-internet/materialize')
        .then(({ finalizeMaterializePageStatus }) =>
          finalizeMaterializePageStatus(pageId, outcome.status === 'completed'),
        )
        .catch(() => undefined)
    }
  }
  if (outcome.status === 'completed') {
    if (existing.source === 'pi-harvest' && existing.sourceId) {
      const harvestSiteId = existing.sourceId
      void import('../personal-internet/pulse')
        .then(({ recomputePulse }) => {
          const pulse = recomputePulse(harvestSiteId)
          if (!pulse) return undefined
          return import('../personal-internet/store').then(({ upsertPulse }) =>
            upsertPulse(harvestSiteId, {
              ...pulse,
              staleAt: null,
            }),
          )
        })
        .catch(() => undefined)
    }
    void import('../personal-internet/refresh/bus')
      .then(({ dispatchTrigger }) => {
        dispatchTrigger({
          triggerName: 'run-completed',
          filterValue: existing.source,
        })
      })
      .catch(() => undefined)
  }
  return updated
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

/** Any active pi-materialize run for a pageId (includes :r… retry keys). */
export function findActiveMaterializeRunForPage(
  pageId: string,
): ScheduledRunRecord | null {
  const row = getDbHandle()
    .sqlite.prepare(
      `SELECT * FROM scheduled_runs
       WHERE source = 'pi-materialize'
         AND source_id = ?
         AND status IN ('pending', 'running', 'awaiting-approval')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(pageId) as ScheduledRunRow | undefined
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
