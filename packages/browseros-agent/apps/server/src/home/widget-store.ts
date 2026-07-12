/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Widget CRUD — SQLite is the primary index; JSON files are not required.
 * The store keeps SQLite as source-of-truth (matching the DB-first pattern
 * used by tasks, skills, and scheduled runs in this codebase).
 */

import { join } from 'node:path'
import { getDbHandle } from '../lib/db'
import { newWidgetId, type WidgetSpec, type WidgetStatus } from './widget-spec'

export type CreateWidgetInput = {
  title: string
  source: WidgetSpec['source']
  action: WidgetSpec['action']
  refreshMinutes: number
  createdBy: WidgetSpec['createdBy']
  whyText: string
  status?: WidgetStatus
}

export function getWidgetsDir(browserosDir: string): string {
  return join(browserosDir, 'home', 'widgets')
}

function upsertRow(spec: WidgetSpec): void {
  getDbHandle()
    .sqlite.prepare(
      `INSERT OR REPLACE INTO home_widgets
        (id, title, source_type, source_query, source_template_id, source_bucket_id,
         action_type, action_target, refresh_minutes, created_by, status,
         show_count, last_action_at, why_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      spec.id,
      spec.title,
      spec.source.type,
      spec.source.query ?? null,
      spec.source.templateId ?? null,
      spec.source.bucketId ?? null,
      spec.action.type,
      spec.action.target,
      spec.refreshMinutes,
      spec.createdBy,
      spec.status,
      spec.showCount,
      spec.lastActionAt ? new Date(spec.lastActionAt).getTime() : null,
      spec.whyText,
      new Date(spec.createdAt).getTime(),
      new Date(spec.updatedAt).getTime(),
    )
}

function rowToSpec(row: Record<string, unknown>): WidgetSpec {
  return {
    id: row.id as string,
    title: row.title as string,
    source: {
      type: row.source_type as WidgetSpec['source']['type'],
      query: (row.source_query as string | null) ?? undefined,
      templateId: (row.source_template_id as string | null) ?? undefined,
      bucketId: (row.source_bucket_id as string | null) ?? undefined,
    },
    action: {
      type: row.action_type as WidgetSpec['action']['type'],
      target: row.action_target as string,
    },
    refreshMinutes: row.refresh_minutes as number,
    createdBy: row.created_by as WidgetSpec['createdBy'],
    status: row.status as WidgetStatus,
    showCount: row.show_count as number,
    lastActionAt:
      row.last_action_at != null
        ? new Date(row.last_action_at as number).toISOString()
        : null,
    whyText: row.why_text as string,
    createdAt: new Date(row.created_at as number).toISOString(),
    updatedAt: new Date(row.updated_at as number).toISOString(),
  }
}

export async function createWidget(
  input: CreateWidgetInput,
  _widgetsDir: string,
): Promise<WidgetSpec> {
  const now = new Date().toISOString()
  const spec: WidgetSpec = {
    id: newWidgetId(),
    title: input.title,
    source: input.source,
    action: input.action,
    refreshMinutes: input.refreshMinutes,
    createdBy: input.createdBy,
    status: input.status ?? 'active',
    showCount: 0,
    lastActionAt: null,
    whyText: input.whyText,
    createdAt: now,
    updatedAt: now,
  }
  upsertRow(spec)
  return spec
}

export async function getWidget(
  id: string,
  _widgetsDir: string,
): Promise<WidgetSpec | null> {
  const row = getDbHandle()
    .sqlite.prepare<Record<string, unknown>, [string]>(
      'SELECT * FROM home_widgets WHERE id = ?',
    )
    .get(id)
  if (!row) return null
  return rowToSpec(row)
}

export async function listWidgets(
  filter: { status?: WidgetStatus | WidgetStatus[] },
  _widgetsDir: string,
): Promise<WidgetSpec[]> {
  const db = getDbHandle().sqlite
  let rows: Record<string, unknown>[]
  if (!filter.status) {
    rows = db
      .prepare<Record<string, unknown>, []>(
        'SELECT * FROM home_widgets ORDER BY created_at DESC',
      )
      .all()
  } else {
    const statuses = Array.isArray(filter.status)
      ? filter.status
      : [filter.status]
    const placeholders = statuses.map(() => '?').join(',')
    rows = db
      .prepare<Record<string, unknown>, string[]>(
        `SELECT * FROM home_widgets WHERE status IN (${placeholders}) ORDER BY created_at DESC`,
      )
      .all(...statuses)
  }
  return rows.map(rowToSpec)
}

export async function archiveWidget(
  id: string,
  _widgetsDir: string,
): Promise<void> {
  getDbHandle()
    .sqlite.prepare(
      'UPDATE home_widgets SET status = ?, updated_at = ? WHERE id = ?',
    )
    .run('archived', Date.now(), id)
}

export async function updateWidgetShowCount(id: string): Promise<void> {
  getDbHandle()
    .sqlite.prepare(
      'UPDATE home_widgets SET show_count = show_count + 1, updated_at = ? WHERE id = ?',
    )
    .run(Date.now(), id)
}

export async function updateWidgetLastAction(id: string): Promise<void> {
  const now = Date.now()
  getDbHandle()
    .sqlite.prepare(
      'UPDATE home_widgets SET last_action_at = ?, updated_at = ? WHERE id = ?',
    )
    .run(now, now, id)
}

export async function setWidgetStatus(
  id: string,
  status: WidgetStatus,
  _widgetsDir: string,
): Promise<void> {
  getDbHandle()
    .sqlite.prepare(
      'UPDATE home_widgets SET status = ?, updated_at = ? WHERE id = ?',
    )
    .run(status, Date.now(), id)
}
