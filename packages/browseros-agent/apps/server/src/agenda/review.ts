import { getDbHandle } from '../lib/db'
import { listPendingApprovals } from '../scheduler/approvals'
import { createRunRecord, getScheduledRun } from '../scheduler/run-executor'
import type { AgendaReport, AgendaReview } from './schema'
import {
  AgendaReportSchema,
  DaySchema,
  shiftDay,
  TimezoneSchema,
} from './schema'

type ReviewRow = {
  id: string
  day: string
  timezone: string
  run_id: string
  report_json: string | null
  created_at: number
  checked_at: number | null
}
const db = () => getDbHandle().sqlite
export function getAgendaReview(
  day: string,
  timezone?: string,
): AgendaReview | null {
  const row = db()
    .prepare(
      `SELECT * FROM agenda_reviews WHERE day = ? ${timezone ? 'AND timezone = ?' : ''} ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(...(timezone ? [day, timezone] : [day])) as ReviewRow | null
  if (!row) return null
  const run = getScheduledRun(row.run_id)
  const report = row.report_json
    ? (JSON.parse(row.report_json) as AgendaReport)
    : null
  const waiting =
    run?.status === 'running' &&
    listPendingApprovals().some(
      (approval) =>
        approval.runId === run.id ||
        (!!run.conversationId &&
          approval.conversationId === run.conversationId),
    )
  const state =
    !run || ['failed', 'cancelled', 'skipped'].includes(run.status)
      ? 'failed'
      : run.status === 'completed'
        ? report
          ? report.outcome
          : 'partial'
        : run.status === 'awaiting-approval' || waiting
          ? 'waiting'
          : run.status === 'pending'
            ? 'queued'
            : 'running'
  return {
    id: row.id,
    runId: row.run_id,
    state,
    conversationId: run?.conversationId ?? null,
    startedAt: row.created_at,
    checkedAt: row.checked_at,
    report,
    message:
      state === 'failed'
        ? 'The review didn’t finish. Your saved items are still here.'
        : state === 'partial' && !report
          ? 'Pane finished without a verified review. Your saved items are still here.'
          : null,
  }
}
export function queueAgendaReview(day: string, timezone: string) {
  DaySchema.parse(day)
  TimezoneSchema.parse(timezone)
  return db().transaction(() => {
    const previous = getAgendaReview(day, timezone)
    if (previous && ['queued', 'running', 'waiting'].includes(previous.state))
      return previous
    const id = `review_${crypto.randomUUID()}`
    const prompt = `Review the user's Pane agenda for ${day} in timezone ${timezone}. This is an explicit Home Refresh request. Maintain the local agenda; do not execute the tasks or change external calendars.
1. Call agenda_list for ${shiftDay(day, -7)} through ${shiftDay(day, 7)}, including closed items. Reuse existing IDs/sourceKeys and expectedVersion. Respect user-edited fields, completed and dismissed items. Do not recreate them with new keys.
2. Retrieve relevant recent discussions and work with context_current_work, context_search and session_search. Read saved-work records and relevant files available in the current workspace. Discover and read relevant connected MCP apps (calendar, tasks, messages) when available. Follow source links from existing items. Narrow searches to this date and the user's active work. Do not read unrelated files or accounts, request new permissions, connect apps, send messages or perform external writes.
3. Reconcile existing items with evidence: update changed facts, close tasks only when completion is verified, dismiss cancelled events only when confirmed, retain items when a source cannot be checked. Add dated commitments, events, useful updates and prepared outputs using agenda_upsert. Include source references, short evidence, observedAt and why this matters. Use sourceKey based on the underlying commitment or external event ID, stable across date changes. Never infer completion from silence or absence in a partial search. Never turn a speculative date into a confirmed obligation; use certainty=suggested when appropriate. Avoid generic advice and duplicate cards. An empty day is valid.
4. Call agenda_review_finish with reviewId=${id}, outcome complete or partial, a brief user-facing summary, sources checked and sources unavailable. Only report complete when the relevant sources could be checked. Missing file/app access must be disclosed as partial. Saving this report is required even when no items changed. Do not claim a full calendar sync or external changes.`
    const run = createRunRecord({
      source: 'manual',
      sourceId: `agenda:${day}`,
      idempotencyKey: id,
      prompt,
      unattended: true,
    })
    db()
      .prepare(
        'INSERT INTO agenda_reviews(id, day, timezone, run_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, day, timezone, run.id, Date.now())
    const review = getAgendaReview(day, timezone)
    if (!review) throw new Error('Review was not queued')
    return review
  })()
}
export function finishAgendaReview(
  id: string,
  runId: string | undefined,
  input: AgendaReport,
  conversationId?: string,
) {
  const report = AgendaReportSchema.parse(input)
  const row = db()
    .prepare('SELECT * FROM agenda_reviews WHERE id=?')
    .get(id) as ReviewRow | null
  if (!row)
    throw new Error('Only the agent assigned to this review can finish it')
  const run = getScheduledRun(row.run_id)
  // ACP tools carry the conversation scope, while in-process tools carry
  // scheduledRunId. Bind either path to this specific persisted review run.
  const ownsReview =
    runId === row.run_id ||
    (!runId && !!conversationId && run?.conversationId === conversationId)
  if (!ownsReview)
    throw new Error('Only the agent assigned to this review can finish it')
  if (!run || !['running', 'awaiting-approval'].includes(run.status))
    throw new Error('This review is no longer running')
  db()
    .prepare('UPDATE agenda_reviews SET report_json=?, checked_at=? WHERE id=?')
    .run(JSON.stringify(report), Date.now(), id)
  return getAgendaReview(row.day, row.timezone)
}
