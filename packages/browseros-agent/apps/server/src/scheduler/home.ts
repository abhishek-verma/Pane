/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Adaptive home data — file + SQLite only, never calls an LLM.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { DIGESTS_DIR } from '@browseros/memory/constants'
import { graphCurrentWork } from '../context/repo'
import { listTasks } from '../context/tasks-repo'
import { ensureMemoriesLayout, readPromptFiles } from '../memory/files'
import { listSkills } from '../memory/store'
import { listPendingApprovals } from './approvals'

export type HomeWidgetType =
  | 'daily-digest'
  | 'pending-approvals'
  | 'resumed-work'
  | 'one-click-recurring'
  | 'recent-sites-fallback'

export interface HomeWidget {
  type: HomeWidgetType
  title: string
  why: string
  rank: number
  pinned?: boolean
  hidden?: boolean
  data: Record<string, unknown>
}

export interface HomePrefs {
  pinned: HomeWidgetType[]
  hidden: HomeWidgetType[]
  dismissed: HomeWidgetType[]
}

const PREF_PIN = /home\.pin:\s*(\S+)/gi
const PREF_HIDE = /home\.hide:\s*(\S+)/gi
const PREF_DISMISS = /home\.dismiss:\s*(\S+)/gi

export function parseHomePrefs(userMd: string): HomePrefs {
  const pinned: HomeWidgetType[] = []
  const hidden: HomeWidgetType[] = []
  const dismissed: HomeWidgetType[] = []
  for (const m of userMd.matchAll(PREF_PIN)) {
    pinned.push(m[1] as HomeWidgetType)
  }
  for (const m of userMd.matchAll(PREF_HIDE)) {
    hidden.push(m[1] as HomeWidgetType)
  }
  for (const m of userMd.matchAll(PREF_DISMISS)) {
    dismissed.push(m[1] as HomeWidgetType)
  }
  return { pinned, hidden, dismissed }
}

export function appendHomePrefLine(
  userMd: string,
  kind: 'pin' | 'hide' | 'dismiss',
  widget: HomeWidgetType,
): string {
  const line = `home.${kind}: ${widget}`
  if (userMd.includes(line)) return userMd
  return `${userMd.trimEnd()}\n- ${line}\n`
}

/** Pure ranking with hysteresis: pinned first, then by rank, skip hidden/dismissed. */
export function rankWidgets(
  candidates: HomeWidget[],
  prefs: HomePrefs,
  previousOrder: HomeWidgetType[] = [],
): HomeWidget[] {
  const blocked = new Set([...prefs.hidden, ...prefs.dismissed])
  const pinned = new Set(prefs.pinned)
  let filtered: HomeWidget[] = candidates
    .filter((w) => !blocked.has(w.type))
    .map((w) => ({
      ...w,
      pinned: pinned.has(w.type),
      hidden: false,
    }))

  filtered.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    if (a.rank !== b.rank) return a.rank - b.rank
    return a.type.localeCompare(b.type)
  })

  // Hysteresis: if previous order exists and set is same, keep relative order
  // unless rank delta is large (>2).
  if (previousOrder.length > 0) {
    const byType = new Map(filtered.map((w) => [w.type, w]))
    const stable: HomeWidget[] = []
    for (const t of previousOrder) {
      const w = byType.get(t)
      if (w) {
        stable.push(w)
        byType.delete(t)
      }
    }
    for (const w of filtered) {
      if (byType.has(w.type)) stable.push(w)
    }
    // Only apply hysteresis when no pin changes
    if (![...pinned].some((p) => !previousOrder.includes(p))) {
      filtered = stable
    }
  }

  return filtered
}

export async function loadHomeWidgets(options?: {
  memoriesRoot?: string
  bucketId?: string
  previousOrder?: HomeWidgetType[]
}): Promise<{
  widgets: HomeWidget[]
  prefs: HomePrefs
  digestPath: string | null
}> {
  const bucketId = options?.bucketId ?? DEFAULT_BUCKET_ID
  const base = await ensureMemoriesLayout(options?.memoriesRoot)
  const files = await readPromptFiles(options?.memoriesRoot)
  const prefs = parseHomePrefs(files.user)

  const candidates: HomeWidget[] = []
  let digestPath: string | null = null
  let digestContent: string | null = null

  const latest = join(base, DIGESTS_DIR, 'latest-daily.md')
  try {
    digestContent = await readFile(latest, 'utf-8')
    digestPath = latest
  } catch {
    // no digest yet
  }

  if (digestContent) {
    candidates.push({
      type: 'daily-digest',
      title: 'Daily digest',
      why: 'Pre-computed this morning from your graph, tasks, and memory.',
      rank: 10,
      data: {
        content: digestContent.slice(0, 4000),
        path: digestPath,
      },
    })
  }

  const approvals = listPendingApprovals()
  if (approvals.length > 0) {
    candidates.push({
      type: 'pending-approvals',
      title: 'Waiting on you',
      why: 'A keep-alive or scheduled run needs approve/deny.',
      rank: 5,
      data: {
        items: approvals.map((a) => ({
          id: a.id,
          toolName: a.toolName,
          preview: a.preview.slice(0, 200),
          runId: a.runId,
        })),
      },
    })
  }

  const inbox = listTasks({ bucketId, status: 'inbox' })
  if (inbox.length > 0 && approvals.length === 0) {
    candidates.push({
      type: 'pending-approvals',
      title: 'Inbox tasks',
      why: 'Open tasks from your Context Graph.',
      rank: 15,
      data: {
        items: inbox.slice(0, 5).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
        })),
      },
    })
  }

  try {
    const work = graphCurrentWork(bucketId)
    const hasWork =
      (work.pages?.length ?? 0) > 0 ||
      (work.files?.length ?? 0) > 0 ||
      (work.tabs?.length ?? 0) > 0 ||
      (work.terminal?.length ?? 0) > 0
    if (hasWork) {
      candidates.push({
        type: 'resumed-work',
        title: 'Pick up where you left off',
        why: 'Recent pages and files from your context graph.',
        rank: 20,
        data: {
          pages: (work.pages ?? []).slice(0, 5),
          files: (work.files ?? []).slice(0, 5),
          tabs: (work.tabs ?? []).slice(0, 5),
        },
      })
    }
  } catch {
    // graph not ready
  }

  try {
    const skills = listSkills({ status: 'active', limit: 20 })
    const recurring = skills.filter(
      (s) =>
        /friday|daily|weekly|every/i.test(s.description) ||
        /friday|daily|weekly|every/i.test(s.name),
    )
    if (recurring.length > 0) {
      candidates.push({
        type: 'one-click-recurring',
        title: 'One-click recurring',
        why: 'Active skills with a detectable cadence.',
        rank: 25,
        data: {
          skills: recurring.slice(0, 3).map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
          })),
        },
      })
    }
  } catch {
    // skills index missing
  }

  // Day-1 fallback always available as lowest rank.
  candidates.push({
    type: 'recent-sites-fallback',
    title: 'Recent sites',
    why: 'Day-1 calm default when the graph is quiet.',
    rank: 100,
    data: {},
  })

  const widgets = rankWidgets(candidates, prefs, options?.previousOrder)
  return { widgets, prefs, digestPath }
}
