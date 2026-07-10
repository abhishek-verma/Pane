/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Hono } from 'hono'
import { z } from 'zod'
import {
  createTriggerRule,
  deleteTriggerRule,
  getTriggerRule,
  listTriggerRules,
  updateTriggerRule,
} from '../../scheduler/rules-store'
import { getScheduledRun } from '../../scheduler/run-executor'
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
  return new Hono<Env>()
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
    .get('/runs/:id', (c) => {
      const run = getScheduledRun(c.req.param('id'))
      if (!run) return c.json({ error: 'not found' }, 404)
      return c.json({ run })
    })
}
