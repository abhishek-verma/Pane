/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  addTask,
  getTask,
  listTasks,
  type TaskStatus,
  updateTask,
} from '../../context/tasks-repo'
import type { Env } from '../types'

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  bucketId: z.string().optional(),
  notes: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
})

const PatchTaskSchema = z.object({
  status: z.enum(['inbox', 'triaged', 'done', 'cancelled']).optional(),
  title: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  scheduledJobId: z.string().nullable().optional(),
})

export function createTasksRoutes() {
  return new Hono<Env>()
    .get('/', (c) => {
      const bucketId = c.req.query('bucketId') || DEFAULT_BUCKET_ID
      const status = c.req.query('status') as TaskStatus | undefined
      const tasks = listTasks({ bucketId, status })
      return c.json({ tasks })
    })
    .post('/', async (c) => {
      const body = CreateTaskSchema.parse(await c.req.json())
      const task = addTask(body)
      return c.json({ task }, 201)
    })
    .patch('/:id', async (c) => {
      const id = c.req.param('id')
      const body = PatchTaskSchema.parse(await c.req.json())
      const task = updateTask(id, body)
      if (!task) return c.json({ error: 'not_found' }, 404)
      return c.json({ task })
    })
    .post('/:id/promote-schedule', async (c) => {
      // Promote is owned by the app (chrome.storage scheduled jobs).
      // Client creates the scheduled task then PATCHes scheduledJobId.
      // This endpoint accepts an already-created job id for convenience.
      const id = c.req.param('id')
      const body = z
        .object({ scheduledJobId: z.string().min(1) })
        .parse(await c.req.json())
      const existing = getTask(id)
      if (!existing) return c.json({ error: 'not_found' }, 404)
      const task = updateTask(id, { scheduledJobId: body.scheduledJobId })
      return c.json({
        task,
        note: 'Scheduled job must be created client-side; this stores the link.',
      })
    })
}
