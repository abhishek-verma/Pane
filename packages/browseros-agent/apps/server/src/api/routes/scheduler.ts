/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ConsequenceClass } from '@browseros/shared/trust/consequence-class'
import { Hono } from 'hono'
import { z } from 'zod'
import { createAgendaRoutes } from '../../agenda/routes'
import { addConversationPin } from '../../agent/conversation-context-store'
import { conversationTurnRegistry } from '../../agent/conversation-turn-registry'
import { getDbHandle } from '../../lib/db'
import {
  handleApprovalInboundText,
  listPendingApprovals,
  resolveByToken,
  signalApprovalResolved,
} from '../../scheduler/approvals'
import { runDailyDigest } from '../../scheduler/digest'
import {
  createScheduledJob,
  deleteScheduledJob,
  enqueueDueScheduledJobs,
  enqueueScheduledJob,
  listScheduledJobs,
  ScheduleInputSchema,
  updateScheduledJob,
} from '../../scheduler/jobs-store'
import { createKeepAliveService } from '../../scheduler/keep-alive'
import {
  createTriggerRule,
  deleteTriggerRule,
  getTriggerRule,
  listTriggerRules,
  updateTriggerRule,
} from '../../scheduler/rules-store'
import {
  claimScheduledRun,
  completeScheduledRun,
  getScheduledRun,
  listScheduledRuns,
  reclaimStaleRunningRuns,
  updateRunStatus,
} from '../../scheduler/run-executor'
import type { Env } from '../types'

const createSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  match: z.object({
    toolName: z.string().optional(),
    occurrenceN: z.number().int().positive().optional(),
    payloadContains: z.string().optional(),
  }),
  bucketId: z.string().optional(),
  jobId: z.string().optional(),
  enabled: z.boolean().optional(),
  cooldownMs: z.number().int().positive().optional(),
})

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  match: z
    .object({
      toolName: z.string().optional(),
      occurrenceN: z.number().int().positive().optional(),
      payloadContains: z.string().optional(),
    })
    .optional(),
  bucketId: z.string().optional(),
  jobId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  cooldownMs: z.number().int().positive().optional(),
})

export function createSchedulerRoutes() {
  const keepAlive = createKeepAliveService()

  return new Hono<Env>()
    .route('/agenda', createAgendaRoutes())
    .get('/jobs', (c) => c.json({ jobs: listScheduledJobs() }))
    .post('/jobs', async (c) =>
      c.json(
        {
          job: createScheduledJob(
            ScheduleInputSchema.parse(await c.req.json()),
          ),
        },
        201,
      ),
    )
    .patch('/jobs/:id', async (c) =>
      c.json({
        job: updateScheduledJob(
          c.req.param('id'),
          ScheduleInputSchema.partial().parse(await c.req.json()),
        ),
      }),
    )
    .delete('/jobs/:id', (c) =>
      c.json({ deleted: deleteScheduledJob(c.req.param('id')) }),
    )
    .post('/jobs/:id/run', (c) =>
      c.json({ run: enqueueScheduledJob(c.req.param('id')) }, 202),
    )
    .get('/triggers', (c) => c.json({ rules: listTriggerRules() }))
    .get('/triggers/:id', (c) => {
      const rule = getTriggerRule(c.req.param('id'))
      if (!rule) return c.json({ error: 'not found' }, 404)
      return c.json({ rule })
    })
    .post('/triggers', async (c) => {
      const body = createSchema.parse(await c.req.json())
      const rule = createTriggerRule(body)
      return c.json({ rule }, 201)
    })
    .patch('/triggers/:id', async (c) => {
      const body = patchSchema.parse(await c.req.json())
      const rule = updateTriggerRule(c.req.param('id'), body)
      if (!rule) return c.json({ error: 'not found' }, 404)
      return c.json({ rule })
    })
    .delete('/triggers/:id', (c) => {
      const ok = deleteTriggerRule(c.req.param('id'))
      if (!ok) return c.json({ error: 'not found' }, 404)
      return c.json({ ok: true })
    })
    .get('/runs', (c) => {
      const status = c.req.query('status')
      if (status?.split(',').includes('pending')) enqueueDueScheduledJobs()
      // Before listing pending, reclaim abandoned running rows so drains retry.
      if (!status || status.split(',').includes('pending')) {
        reclaimStaleRunningRuns()
      }
      const runs = listScheduledRuns({
        status: status
          ? (status.split(',') as Array<
              | 'pending'
              | 'running'
              | 'completed'
              | 'failed'
              | 'skipped'
              | 'cancelled'
              | 'awaiting-approval'
            >)
          : undefined,
        limit: 200,
      })
      return c.json({ runs })
    })
    .get('/runs/:id', (c) => {
      const run = getScheduledRun(c.req.param('id'))
      if (!run) return c.json({ error: 'not found' }, 404)
      return c.json({ run })
    })
    .post('/runs/:id/cancel', (c) => {
      const run = getScheduledRun(c.req.param('id'))
      if (!run) return c.json({ error: 'not found' }, 404)
      if (!['pending', 'running', 'awaiting-approval'].includes(run.status))
        return c.json({ cancelled: false })
      if (run.conversationId)
        conversationTurnRegistry.cancelActiveFor(
          run.conversationId,
          'scheduled-job-cancelled',
        )
      updateRunStatus(run.id, {
        status: 'cancelled',
        completedAt: Date.now(),
        error: 'Cancelled by user',
      })
      return c.json({ cancelled: true })
    })
    .delete('/runs/:id', (c) => {
      const run = getScheduledRun(c.req.param('id'))
      if (!run) return c.json({ error: 'not found' }, 404)
      if (['pending', 'running', 'awaiting-approval'].includes(run.status))
        return c.json({ error: 'Cancel the run before deleting it' }, 409)
      getDbHandle()
        .sqlite.query('DELETE FROM scheduled_runs WHERE id = ?')
        .run(run.id)
      return c.json({ deleted: true })
    })
    .post('/runs/:id/claim', (c) => {
      const run = claimScheduledRun(c.req.param('id'))
      if (!run) {
        return c.json({ error: 'not claimable (missing or not pending)' }, 409)
      }
      return c.json({ run })
    })
    .patch('/runs/:id', async (c) => {
      const body = z
        .object({
          conversationId: z.string().nullable().optional(),
        })
        .parse(await c.req.json())
      const existing = getScheduledRun(c.req.param('id'))
      if (!existing) return c.json({ error: 'not found' }, 404)
      if (existing.status !== 'running' && existing.status !== 'pending') {
        return c.json({ error: 'not patchable in current status' }, 409)
      }
      const run = updateRunStatus(c.req.param('id'), {
        conversationId: body.conversationId,
      })
      return c.json({ run })
    })
    .post('/runs/:id/complete', async (c) => {
      const body = z
        .object({
          status: z.enum(['completed', 'failed', 'cancelled', 'skipped']),
          result: z.string().nullable().optional(),
          error: z.string().nullable().optional(),
          conversationId: z.string().nullable().optional(),
        })
        .parse(await c.req.json())
      const run = completeScheduledRun(c.req.param('id'), body)
      if (!run) {
        return c.json(
          { error: 'not completable (missing or not running)' },
          409,
        )
      }
      return c.json({ run })
    })
    .post('/digest/run', async (c) => {
      const result = await runDailyDigest({
        skipBatteryCheck: true,
        skipQuietHours: true,
        force: true,
      })
      return c.json(result)
    })
    .get('/keep-alive', async (c) => c.json(await keepAlive.status()))
    .post('/keep-alive/install', async (c) => {
      try {
        return c.json(await keepAlive.install())
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : String(err) },
          501,
        )
      }
    })
    .post('/keep-alive/uninstall', async (c) =>
      c.json(await keepAlive.uninstall()),
    )
    .get('/approvals', (c) => c.json({ approvals: listPendingApprovals() }))
    .post('/approvals/resolve', async (c) => {
      const body = z
        .object({ token: z.string().min(1), pin: z.boolean().optional() })
        .parse(await c.req.json())
      const result = resolveByToken(body.token)
      if (!result) return c.json({ error: 'unknown token' }, 404)
      if (
        body.pin &&
        result.resolution === 'approved' &&
        result.resumed &&
        ['write-local', 'system', 'write-external', 'spend'].includes(
          result.approval.consequenceClass,
        ) &&
        result.approval.conversationId
      ) {
        addConversationPin(
          result.approval.conversationId,
          result.approval.consequenceClass as ConsequenceClass,
        )
      }
      signalApprovalResolved(result.approval.id, result.resolution)
      return c.json({
        ...result,
        resumed: result.resumed,
        reason: result.resumed ? undefined : 'no_active_waiter',
      })
    })
    .post('/approvals/inbound', async (c) => {
      const body = z.object({ text: z.string() }).parse(await c.req.json())
      return c.json(handleApprovalInboundText(body.text))
    })
    .get('/home', async (c) => {
      const { loadHome } = await import('../../scheduler/home')
      const data = await loadHome()
      return c.json(data)
    })
}
