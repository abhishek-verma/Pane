/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { ensureDefaultBucket } from '@browseros/context-graph/repo'
import type { GraphSqlDatabase } from '@browseros/context-graph/types'
import { getDbHandle } from '../lib/db'

export type TaskStatus = 'inbox' | 'triaged' | 'done' | 'cancelled'

export interface Task {
  id: string
  bucketId: string
  title: string
  status: TaskStatus
  notes: string | null
  createdAt: number
  updatedAt: number
  scheduledJobId: string | null
  nodeIds?: string[]
}

function sqlite(): GraphSqlDatabase {
  return getDbHandle().sqlite as unknown as GraphSqlDatabase
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    bucketId: String(row.bucket_id),
    title: String(row.title),
    status: row.status as TaskStatus,
    notes: (row.notes as string | null) ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    scheduledJobId: (row.scheduled_job_id as string | null) ?? null,
  }
}

export function listTasks(options: {
  bucketId?: string
  status?: TaskStatus
}): Task[] {
  const bucketId = options.bucketId ?? DEFAULT_BUCKET_ID
  ensureDefaultBucket(sqlite())
  const rows = options.status
    ? sqlite()
        .prepare<Record<string, unknown>>(
          `SELECT * FROM tasks WHERE bucket_id = ? AND status = ?
           ORDER BY updated_at DESC`,
        )
        .all(bucketId, options.status)
    : sqlite()
        .prepare<Record<string, unknown>>(
          `SELECT * FROM tasks WHERE bucket_id = ?
           ORDER BY updated_at DESC`,
        )
        .all(bucketId)

  return rows.map((row) => {
    const task = rowToTask(row)
    task.nodeIds = listTaskNodeIds(task.id)
    return task
  })
}

export function getTask(id: string): Task | null {
  const row = sqlite()
    .prepare<Record<string, unknown>>('SELECT * FROM tasks WHERE id = ?')
    .get(id)
  if (!row) return null
  const task = rowToTask(row)
  task.nodeIds = listTaskNodeIds(task.id)
  return task
}

export function addTask(input: {
  title: string
  bucketId?: string
  notes?: string
  nodeIds?: string[]
}): Task {
  ensureDefaultBucket(sqlite())
  const id = newId('task')
  const ts = Date.now()
  const bucketId = input.bucketId ?? DEFAULT_BUCKET_ID
  sqlite()
    .prepare(
      `INSERT INTO tasks
         (id, bucket_id, title, status, notes, created_at, updated_at, scheduled_job_id)
       VALUES (?, ?, ?, 'inbox', ?, ?, ?, NULL)`,
    )
    .run(id, bucketId, input.title, input.notes ?? null, ts, ts)

  for (const nodeId of input.nodeIds ?? []) {
    linkTaskNode(id, nodeId)
  }
  return getTask(id)!
}

export function updateTask(
  id: string,
  patch: {
    status?: TaskStatus
    title?: string
    notes?: string | null
    scheduledJobId?: string | null
  },
): Task | null {
  const existing = getTask(id)
  if (!existing) return null
  const ts = Date.now()
  sqlite()
    .prepare(
      `UPDATE tasks SET
         title = ?,
         status = ?,
         notes = ?,
         scheduled_job_id = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.title ?? existing.title,
      patch.status ?? existing.status,
      patch.notes !== undefined ? patch.notes : existing.notes,
      patch.scheduledJobId !== undefined
        ? patch.scheduledJobId
        : existing.scheduledJobId,
      ts,
      id,
    )
  return getTask(id)
}

export function markTaskDone(id: string): Task | null {
  return updateTask(id, { status: 'done' })
}

export function linkTaskNode(taskId: string, nodeId: string): void {
  const id = newId('tlink')
  sqlite()
    .prepare(
      `INSERT INTO task_links (id, task_id, node_id, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(id, taskId, nodeId, Date.now())
}

function listTaskNodeIds(taskId: string): string[] {
  return sqlite()
    .prepare<{ node_id: string }>(
      'SELECT node_id FROM task_links WHERE task_id = ?',
    )
    .all(taskId)
    .map((r) => r.node_id)
}
