/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Per-source-type data executors for home widgets.
 * Each binding takes a WidgetSpec and returns structured items for display.
 * No LLM calls; reads from SQLite / file system only.
 */

import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { listCaptureSessions } from '../capture/meeting-pipeline'
import { graphCurrentWork } from '../context/repo'
import { listTasks } from '../context/tasks-repo'
import { getDbHandle } from '../lib/db'
import { listSkills } from '../memory/store'
import { listPendingApprovals } from '../scheduler/approvals'
import type { WidgetSpec } from './widget-spec'

export interface BindingItem {
  label: string
  sublabel?: string
  meta?: string
  id?: string
}

export interface BindingResult {
  items: BindingItem[]
  count: number
  primaryLabel?: string
  primarySublabel?: string
}

export async function executeBinding(spec: WidgetSpec): Promise<BindingResult> {
  const bucketId = spec.source.bucketId ?? DEFAULT_BUCKET_ID
  try {
    switch (spec.source.type) {
      case 'tasks':
        return bindTasks(spec, bucketId)
      case 'scheduled':
        return bindScheduled()
      case 'capture':
        return await bindCapture(bucketId)
      case 'graph':
        return bindGraph(bucketId)
      case 'skills':
        return bindSkills(spec)
      case 'template':
        return await bindTemplate(spec, bucketId)
      default:
        return { items: [], count: 0 }
    }
  } catch {
    return { items: [], count: 0 }
  }
}

function bindTasks(spec: WidgetSpec, bucketId: string): BindingResult {
  const query = spec.source.query ?? ''
  if (query.includes('type:approval')) {
    const approvals = listPendingApprovals()
    return {
      items: approvals.slice(0, 5).map((a) => ({
        id: a.id,
        label: a.toolName,
        sublabel: a.preview.slice(0, 80),
      })),
      count: approvals.length,
      primaryLabel:
        approvals.length > 0
          ? `${approvals.length} action${approvals.length === 1 ? '' : 's'} waiting`
          : undefined,
    }
  }
  const status = query.includes('status:pending') ? 'pending' : undefined
  const tasks = listTasks({ bucketId, status })
  return {
    items: tasks
      .slice(0, 5)
      .map((t) => ({ id: t.id, label: t.title, meta: t.status })),
    count: tasks.length,
    primaryLabel:
      tasks.length > 0
        ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}`
        : undefined,
  }
}

function bindScheduled(): BindingResult {
  const db = getDbHandle().sqlite
  const row = db
    .prepare<
      { id: string; prompt: string; source: string; created_at: number },
      []
    >(
      `SELECT id, prompt, source, created_at FROM scheduled_runs
       WHERE status = 'pending'
       ORDER BY created_at ASC LIMIT 1`,
    )
    .get()
  if (!row) return { items: [], count: 0 }
  return {
    items: [{ id: row.id, label: row.prompt.slice(0, 80), meta: row.source }],
    count: 1,
    primaryLabel: row.prompt.slice(0, 60),
  }
}

async function bindCapture(bucketId: string): Promise<BindingResult> {
  const sessions = listCaptureSessions({ bucketId, kind: 'research' })
  const recent = sessions.slice(0, 3)
  return {
    items: recent.map((s) => ({
      id: s.id,
      label: s.title ?? 'Research session',
      meta: s.status,
    })),
    count: sessions.length,
    primaryLabel: recent[0]?.title ?? undefined,
  }
}

function bindGraph(bucketId: string): BindingResult {
  const work = graphCurrentWork(bucketId)
  const pages = (work.pages ?? []).slice(0, 3)
  return {
    items: pages.map((p: { title?: string; uri?: string }) => ({
      label: p.title ?? p.uri ?? '',
      sublabel: p.uri,
    })),
    count: (work.pages ?? []).length,
  }
}

function bindSkills(spec: WidgetSpec): BindingResult {
  const skills = listSkills({ status: 'active', limit: 20 })
  const tag = spec.source.query ?? ''
  const filtered = tag
    ? skills.filter(
        (s) =>
          new RegExp(tag, 'i').test(s.name) ||
          new RegExp(tag, 'i').test(s.description),
      )
    : skills.filter((s) =>
        /friday|daily|weekly|every/i.test(`${s.name} ${s.description}`),
      )
  return {
    items: filtered.slice(0, 3).map((s) => ({
      id: s.id,
      label: s.name,
      sublabel: s.description.slice(0, 60),
    })),
    count: filtered.length,
  }
}

async function bindTemplate(
  spec: WidgetSpec,
  bucketId: string,
): Promise<BindingResult> {
  const templateId = spec.source.templateId ?? ''
  if (templateId === 'daily-digest') {
    return { items: [], count: 0, primaryLabel: 'Daily digest available' }
  }
  if (templateId === 'open-tasks') {
    return bindTasks(
      { ...spec, source: { type: 'tasks', query: 'status:pending' } },
      bucketId,
    )
  }
  if (templateId === 'next-scheduled-run') return bindScheduled()
  if (templateId === 'active-research-thread') return bindCapture(bucketId)
  if (templateId === 'pending-approvals') {
    return bindTasks(
      { ...spec, source: { type: 'tasks', query: 'type:approval' } },
      bucketId,
    )
  }
  return { items: [], count: 0 }
}
