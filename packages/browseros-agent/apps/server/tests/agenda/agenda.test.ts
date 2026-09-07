import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultMcpGateContext } from '@browseros/browser-mcp/trust/mcp-gate'
import { Hono } from 'hono'
import { drainPendingRunsOnce } from '../../../app/lib/schedules/drainPendingRuns'
import {
  finishAgendaReview,
  getAgendaReview,
  queueAgendaReview,
} from '../../src/agenda/review'
import { createAgendaRoutes } from '../../src/agenda/routes'
import { DaySchema, dayInTimezone } from '../../src/agenda/schema'
import {
  agendaForDay,
  listAgendaItems,
  updateAgendaItem,
  upsertAgendaItem,
} from '../../src/agenda/store'
import { buildAgendaToolSet } from '../../src/agenda/tools'
import { runWithGateContext } from '../../src/agent/trust/gate'
import { createSchedulerRoutes } from '../../src/api/routes/scheduler'
import { registerContextMcpTools } from '../../src/context/register-mcp'
import { closeDb, getDbHandle, initializeDb } from '../../src/lib/db'
import { createPendingApproval } from '../../src/scheduler/approvals'
import {
  claimScheduledRun,
  completeScheduledRun,
  updateRunStatus,
} from '../../src/scheduler/run-executor'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pane-agenda-'))
  initializeDb({ dbPath: join(dir, 'test.sqlite') })
})
afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})
const day = '2026-09-07'
const timezone = 'Asia/Kolkata'
const source = {
  kind: 'conversation' as const,
  label: 'Trip planning',
  reference: 'conv-trip',
  evidence: 'Choose a hotel on September 7',
  observedAt: '2026-09-07T09:00:00+05:30',
}
const input = (key = 'trip:hotel') => ({
  sourceKey: key,
  title: 'Choose a hotel',
  day,
  timezone,
  kind: 'task' as const,
  why: 'You planned to book before Friday.',
  sources: [source],
})
const report = {
  outcome: 'complete' as const,
  summary: 'Your hotel plan is current.',
  checked: ['Trip discussion'],
  unavailable: [],
}

describe('persistent agenda', () => {
  it('deduplicates retried creates and requires current versions for edits', () => {
    const item = upsertAgendaItem(input())
    expect(upsertAgendaItem({ ...input(), title: 'Duplicate' }).id).toBe(
      item.id,
    )
    expect(listAgendaItems(day, day)).toHaveLength(1)
    const updated = upsertAgendaItem({
      ...input(),
      id: item.id,
      expectedVersion: item.version,
      title: 'Compare hotels',
    })
    expect(updated.version).toBe(2)
    expect(() => upsertAgendaItem({ ...input(), expectedVersion: 1 })).toThrow(
      'changed',
    )
    closeDb()
    initializeDb({ dbPath: join(dir, 'test.sqlite') })
    expect(listAgendaItems(day, day)[0]?.title).toBe('Compare hotels')
  })
  it('preserves user completion and rescheduling during an agent refresh', () => {
    const item = upsertAgendaItem(input())
    const moved = updateAgendaItem({
      id: item.id,
      expectedVersion: 1,
      day: '2026-09-09',
    })
    const done = updateAgendaItem({
      id: item.id,
      expectedVersion: moved.version,
      status: 'done',
    })
    const refreshed = upsertAgendaItem({
      ...input(),
      expectedVersion: done.version,
      title: 'New verified detail',
    })
    expect(refreshed.day).toBe('2026-09-09')
    expect(refreshed.status).toBe('done')
    expect(() =>
      updateAgendaItem(
        { id: item.id, expectedVersion: refreshed.version, status: 'open' },
        'agent',
      ),
    ).toThrow('user')
    const restored = updateAgendaItem({
      id: item.id,
      expectedVersion: refreshed.version,
      status: 'open',
    })
    expect(restored.status).toBe('open')
  })
  it('does not accept stale user mutations', () => {
    const item = upsertAgendaItem(input())
    updateAgendaItem({ id: item.id, expectedVersion: 1, status: 'dismissed' })
    expect(() =>
      updateAgendaItem({ id: item.id, expectedVersion: 1, day: '2026-09-08' }),
    ).toThrow('changed')
  })
  it('keeps source identity when an event moves and validates exact time timezone', () => {
    const event = {
      ...input('calendar:123'),
      kind: 'event' as const,
      startsAt: '2026-09-06T20:00:00Z',
      endsAt: '2026-09-06T21:00:00Z',
    }
    const item = upsertAgendaItem(event)
    expect(item.day).toBe(day)
    const changed = upsertAgendaItem({
      ...event,
      expectedVersion: item.version,
      day: '2026-09-08',
      startsAt: '2026-09-07T20:00:00Z',
      endsAt: '2026-09-07T21:00:00Z',
    })
    expect(changed.id).toBe(item.id)
    expect(() =>
      upsertAgendaItem({ ...event, sourceKey: 'bad', day: '2026-09-06' }),
    ).toThrow('timezone')
  })
  it('moving an event manually clears its exact time', () => {
    const item = upsertAgendaItem({
      ...input(),
      kind: 'event',
      startsAt: '2026-09-07T14:00:00+05:30',
    })
    const moved = updateAgendaItem({
      id: item.id,
      expectedVersion: 1,
      day: '2026-09-08',
    })
    expect(moved.startsAt).toBeNull()
    expect(moved.userFields).toContain('startsAt')
  })
  it('selects a local date at midnight and handles leap dates', () => {
    expect(dayInTimezone(timezone, Date.parse('2026-09-06T20:00:00Z'))).toBe(
      day,
    )
    expect(DaySchema.safeParse('2026-02-30').success).toBe(false)
    expect(DaySchema.safeParse('2028-02-29').success).toBe(true)
  })
  it('carries only recent unfinished tasks, not old events or completed work', () => {
    upsertAgendaItem({ ...input('old-task'), day: '2026-09-06' })
    upsertAgendaItem({
      ...input('old-event'),
      kind: 'event',
      day: '2026-09-06',
    })
    upsertAgendaItem({ ...input('ancient-task'), day: '2026-08-01' })
    const closed = upsertAgendaItem({ ...input('closed'), day: '2026-09-06' })
    updateAgendaItem({ id: closed.id, expectedVersion: 1, status: 'done' })
    const snapshot = agendaForDay(
      day,
      timezone,
      Date.parse('2026-09-07T10:00:00+05:30'),
    )
    expect(snapshot.items.map((item) => item.sourceKey)).toEqual(['old-task'])
    expect(agendaForDay('2026-09-06', timezone).items).toHaveLength(3)
  })
  it('requires real sources and keeps date-range reads bounded', () => {
    expect(() => upsertAgendaItem({ ...input(), sources: [] })).toThrow()
    expect(() => listAgendaItems('2026-01-01', '2026-12-31')).toThrow('93 days')
  })
})

describe('background agenda review', () => {
  it('coalesces clicks and does not claim freshness merely because a run completed', () => {
    const review = queueAgendaReview(day, timezone)
    expect(queueAgendaReview(day, timezone)?.runId).toBe(review.runId)
    claimScheduledRun(review.runId)
    completeScheduledRun(review.runId, { status: 'completed', result: 'Done' })
    expect(getAgendaReview(day)?.state).toBe('partial')
    expect(getAgendaReview(day)?.checkedAt).toBeNull()
    expect(queueAgendaReview(day, timezone)?.runId).not.toBe(review.runId)
  })
  it('only lets the owning running agent save a source-check report', () => {
    const review = queueAgendaReview(day, timezone)
    claimScheduledRun(review.runId)
    expect(() => finishAgendaReview(review.id, 'wrong', report)).toThrow(
      'assigned',
    )
    finishAgendaReview(review.id, review.runId, report)
    completeScheduledRun(review.runId, { status: 'completed' })
    expect(getAgendaReview(day)?.state).toBe('complete')
    expect(() => finishAgendaReview(review.id, review.runId, report)).toThrow(
      'no longer',
    )
  })
  it('surfaces unavailable sources and failures while retaining saved items', () => {
    upsertAgendaItem(input())
    const review = queueAgendaReview(day, timezone)
    claimScheduledRun(review.runId)
    expect(() =>
      finishAgendaReview(review.id, review.runId, {
        ...report,
        unavailable: ['Calendar'],
      }),
    ).toThrow()
    finishAgendaReview(review.id, review.runId, {
      ...report,
      outcome: 'partial',
      unavailable: ['Calendar'],
    })
    completeScheduledRun(review.runId, { status: 'completed' })
    expect(getAgendaReview(day)?.state).toBe('partial')
    const retry = queueAgendaReview(day, timezone)
    claimScheduledRun(retry.runId)
    completeScheduledRun(retry.runId, {
      status: 'failed',
      error: 'Provider unavailable',
    })
    expect(getAgendaReview(day)?.state).toBe('failed')
    expect(listAgendaItems(day, day)).toHaveLength(1)
  })
  it('exposes working tool output including review ownership through the harness', async () => {
    const tools = buildAgendaToolSet()
    const result = (await tools.agenda_upsert.execute?.(input(), {
      toolCallId: '1',
      messages: [],
    })) as { text: string }
    expect(JSON.parse(result.text).item.title).toBe('Choose a hotel')
    const review = queueAgendaReview(day, timezone)
    claimScheduledRun(review.runId)
    const ctx = {
      ...createDefaultMcpGateContext(),
      scheduledRunId: review.runId,
    }
    const output = (await runWithGateContext(ctx, () =>
      tools.agenda_review_finish.execute?.(
        { reviewId: review.id, report },
        { toolCallId: '2', messages: [] },
      ),
    )) as { isError?: boolean }
    expect(output.isError).toBeUndefined()
  })
  it('serves saved dates locally and queues refresh separately', async () => {
    const app = new Hono().route('/scheduler/agenda', createAgendaRoutes())
    const local = await app.request(
      `/scheduler/agenda?day=${day}&timezone=Asia%2FKolkata`,
    )
    expect(local.status).toBe(200)
    expect(
      (
        getDbHandle()
          .sqlite.prepare('SELECT COUNT(*) as count FROM scheduled_runs')
          .get() as { count: number }
      ).count,
    ).toBe(0)
    const created = await app.request('/scheduler/agenda/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day, timezone, title: 'Buy groceries' }),
    })
    expect(created.status).toBe(201)
    const item = (await created.json()).item
    const changed = await app.request(`/scheduler/agenda/items/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, status: 'done' }),
    })
    expect(changed.status).toBe(200)
    const queued = await app.request('/scheduler/agenda/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day, timezone }),
    })
    expect(queued.status).toBe(202)
    const bad = await app.request(
      '/scheduler/agenda?day=2026-02-30&timezone=Asia%2FKolkata',
    )
    expect(bad.status).toBe(400)
  })
})

it('bootstraps agenda tables when packaged migrations are unavailable', () => {
  closeDb()
  initializeDb({
    dbPath: join(dir, 'fallback.sqlite'),
    migrationsDir: join(dir, 'missing-migrations'),
  })
  const item = upsertAgendaItem(input())
  expect(item.title).toBe('Choose a hotel')
  expect(queueAgendaReview(day, timezone).state).toBe('queued')
})

it('keeps evidence of agent completion and protects user fields in its audit trail', () => {
  const item = upsertAgendaItem(input())
  updateAgendaItem(
    { id: item.id, expectedVersion: 1, status: 'done' },
    'agent',
    'Booking confirmation received in the trip conversation',
  )
  const row = getDbHandle()
    .sqlite.prepare(
      'SELECT evidence, actor FROM agenda_changes WHERE item_id=? ORDER BY id DESC LIMIT 1',
    )
    .get(item.id) as { evidence: string; actor: string }
  expect(row.actor).toBe('agent')
  expect(row.evidence).toContain('Booking confirmation')
})

it('binds ACP review completion to the persisted conversation owner', async () => {
  const review = queueAgendaReview(day, timezone)
  claimScheduledRun(review.runId)
  updateRunStatus(review.runId, { conversationId: 'acp-owner' })
  const tools = buildAgendaToolSet()
  const execute = () =>
    tools.agenda_review_finish.execute?.(
      { reviewId: review.id, report },
      { toolCallId: 'mcp', messages: [] },
    )
  const wrong = (await runWithGateContext(
    { ...createDefaultMcpGateContext(), conversationId: 'other-conversation' },
    execute,
  )) as { isError?: boolean }
  expect(wrong.isError).toBe(true)
  const correct = (await runWithGateContext(
    { ...createDefaultMcpGateContext(), conversationId: 'acp-owner' },
    execute,
  )) as { isError?: boolean }
  expect(correct.isError).toBeUndefined()
  completeScheduledRun(review.runId, { status: 'completed' })
  expect(getAgendaReview(day)?.state).toBe('complete')
})

it('shows actual pending approval state for the review and ignores expired or unrelated approvals', () => {
  const review = queueAgendaReview(day, timezone)
  claimScheduledRun(review.runId)
  updateRunStatus(review.runId, { conversationId: 'review-conversation' })
  const approval = {
    runId: 'acp-session',
    conversationId: 'other',
    toolCallId: 'a',
    toolName: 'filesystem_read',
    consequenceClass: 'read-local',
    preview: 'Read selected file',
  }
  createPendingApproval(approval)
  createPendingApproval({
    ...approval,
    conversationId: 'review-conversation',
    timeoutMs: -1,
  })
  expect(getAgendaReview(day)?.state).toBe('running')
  createPendingApproval({ ...approval, conversationId: 'review-conversation' })
  expect(getAgendaReview(day)?.state).toBe('waiting')
  completeScheduledRun(review.runId, { status: 'completed' })
  expect(getAgendaReview(day)?.state).toBe('partial')
})

it('wires Home refresh through the real scheduler, background drain, gated ACP tools and persisted day response', async () => {
  const app = new Hono().route('/scheduler', createSchedulerRoutes())
  const fetchFn = ((url: RequestInfo | URL, init?: RequestInit) =>
    app.request(String(url), init)) as typeof fetch
  const response = await app.request('/scheduler/agenda/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ day, timezone }),
  })
  expect(response.status).toBe(202)
  const { review } = await response.json()
  const result = await drainPendingRunsOnce({
    getBaseUrl: async () => 'http://localhost',
    fetchFn,
    runIds: [review.runId],
    runChat: async ({ conversationId, useSelectedWorkspace }) => {
      if (!conversationId) throw new Error('Missing review owner')
      expect(useSelectedWorkspace).toBe(true)
      expect(getAgendaReview(day)?.conversationId).toBe(conversationId)
      const handlers = new Map<
        string,
        (
          args: Record<string, unknown>,
        ) => Promise<{ isError?: boolean; content: { text: string }[] }>
      >()
      registerContextMcpTools(
        {
          registerTool: (name: string, _config: unknown, handler: never) =>
            handlers.set(name, handler),
        } as never,
        {
          gateContext: { ...createDefaultMcpGateContext(), conversationId },
        },
      )
      const call = (name: string, args: Record<string, unknown>) => {
        const handler = handlers.get(name)
        if (!handler) throw new Error(`Missing registered tool: ${name}`)
        return handler(args)
      }
      const listed = await call('agenda_list', {
        from: day,
        to: day,
        includeClosed: true,
      })
      expect(listed.isError).toBeFalsy()
      const saved = await call('agenda_upsert', input())
      expect(saved.isError).toBeFalsy()
      const finished = await call('agenda_review_finish', {
        reviewId: review.id,
        report,
      })
      expect(finished.isError).toBeFalsy()
      return {
        text: 'Reviewed the trip discussion',
        conversationId: conversationId,
      }
    },
  })
  expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 })
  closeDb()
  initializeDb({ dbPath: join(dir, 'test.sqlite') })
  const snapshot = await (
    await app.request(`/scheduler/agenda?day=${day}&timezone=Asia%2FKolkata`)
  ).json()
  expect(snapshot.items[0].title).toBe('Choose a hotel')
  expect(snapshot.review.state).toBe('complete')
  expect(snapshot.review.report.checked).toEqual(['Trip discussion'])
  expect(snapshot.review.conversationId).toBeTruthy()
})
