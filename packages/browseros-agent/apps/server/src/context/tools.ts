/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
} from '@browseros/context-graph/constants'
import { PROMOTED_ARG } from '@browseros/shared/trust/consequence-class'
import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { getDeniedHosts } from './grants'
import { graphCurrentWork, graphSearch } from './repo'
import { addTask, listTasks, markTaskDone, type TaskStatus } from './tasks-repo'

/** Optional MCP promote flag — must be in the schema or the SDK strips it. */
const promotedField = {
  [PROMOTED_ARG]: z.boolean().optional(),
} as const

const RECALL_STUB =
  'Memory recall is not available yet (Phase 4). Use context_search for activity.'

function formatCurrentWork(bucketId: string): string {
  const denied = getDeniedHosts(bucketId)
  const work = graphCurrentWork(bucketId, { deniedHosts: denied })
  const lines: string[] = [`Current work (bucket=${bucketId}):`]
  const section = (
    label: string,
    items: Array<{ title: string | null; uri: string | null }>,
  ) => {
    if (items.length === 0) return
    lines.push(`\n${label}:`)
    for (const item of items.slice(0, 8)) {
      lines.push(
        `- ${item.title ?? '(untitled)'} ${item.uri ? `(${item.uri})` : ''}`,
      )
    }
  }
  section('Tabs', work.tabs)
  section('Pages', work.pages)
  section('Files', work.files)
  section('Terminal', work.terminal)
  section('Runs', work.runs)
  if (lines.length === 1) lines.push('\n(nothing indexed yet)')
  return lines.join('\n')
}

export function buildContextToolSet(getBucketId: () => string): ToolSet {
  return {
    context_current_work: tool({
      description:
        'Summarize what Pane knows about current work in the active context bucket (tabs, pages, files, terminal, recent runs).',
      inputSchema: z.object({
        bucketId: z.string().optional(),
      }),
      execute: async ({ bucketId }) => {
        const id = bucketId || getBucketId()
        return { text: formatCurrentWork(id) }
      },
    }),
    context_search: tool({
      description:
        'Search the local context graph. Returns short snippets only (not full documents) for prompt-budget discipline.',
      inputSchema: z.object({
        query: z.string().min(1),
        bucketId: z.string().optional(),
        limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
      }),
      execute: async ({ query, bucketId, limit }) => {
        const id = bucketId || getBucketId()
        const denied = getDeniedHosts(id)
        const hits = graphSearch(id, query, limit ?? SEARCH_DEFAULT_LIMIT, {
          deniedHosts: denied,
        })
        if (hits.length === 0) {
          return { text: `No context matches for "${query}".` }
        }
        const lines = hits.map(
          (h, i) =>
            `${i + 1}. [${h.kind}] ${h.title ?? '(untitled)'} — ${h.uri ?? ''}\n   ${h.snippet}`,
        )
        return { text: lines.join('\n') }
      },
    }),
    context_recall: tool({
      description:
        'Recall long-term memory (Phase 4). Currently a stub — use context_search for activity.',
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      execute: async () => ({ text: RECALL_STUB }),
    }),
  }
}

export function buildTasksToolSet(getBucketId: () => string): ToolSet {
  return {
    tasks_list: tool({
      description: 'List tasks in the active context bucket inbox.',
      inputSchema: z.object({
        bucketId: z.string().optional(),
        status: z.enum(['inbox', 'triaged', 'done', 'cancelled']).optional(),
      }),
      execute: async ({ bucketId, status }) => {
        const tasks = listTasks({
          bucketId: bucketId || getBucketId(),
          status: status as TaskStatus | undefined,
        })
        if (tasks.length === 0) return { text: 'No tasks.' }
        return {
          text: tasks
            .map(
              (t) =>
                `- [${t.status}] ${t.title} (${t.id})${t.scheduledJobId ? ' scheduled' : ''}`,
            )
            .join('\n'),
        }
      },
    }),
    tasks_add: tool({
      description: 'Add a task to the local inbox.',
      inputSchema: z.object({
        title: z.string().min(1),
        bucketId: z.string().optional(),
        notes: z.string().optional(),
        ...promotedField,
      }),
      execute: async ({ title, bucketId, notes }) => {
        const task = addTask({
          title,
          bucketId: bucketId || getBucketId(),
          notes,
        })
        return { text: `Created task ${task.id}: ${task.title}` }
      },
    }),
    tasks_done: tool({
      description: 'Mark a task as done.',
      inputSchema: z.object({
        id: z.string().min(1),
        ...promotedField,
      }),
      execute: async ({ id }) => {
        const task = markTaskDone(id)
        if (!task) return { text: `Task not found: ${id}`, isError: true }
        return { text: `Marked done: ${task.title}` }
      },
    }),
  }
}

export { RECALL_STUB }
