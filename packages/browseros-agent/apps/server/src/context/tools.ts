/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { SEARCH_MAX_LIMIT } from '@browseros/context-graph/constants'
import {
  RECALL_DEFAULT_LIMIT,
  RECALL_MAX_LIMIT,
  RECALL_SNIPPET_MAX_CHARS,
} from '@browseros/memory/constants'
import { contentTokens } from '@browseros/retrieval/normalize'
import { PROMOTED_ARG } from '@browseros/shared/trust/consequence-class'
import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { bumpSurfaced, listEntries } from '../memory/store'
import { searchChatFts } from '../retrieval/chat-fts'
import { formatRetrieveResult, hybridSearch } from '../retrieval/hybrid'
import { getDeniedHosts } from './grants'
import { graphCurrentWork } from './repo'
import { addTask, listTasks, markTaskDone, type TaskStatus } from './tasks-repo'

/** Optional MCP promote flag — must be in the schema or the SDK strips it. */
const promotedField = {
  [PROMOTED_ARG]: z.boolean().optional(),
} as const

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
  section('Meetings', work.meetings)
  section('Files', work.files)
  section('Terminal', work.terminal)
  section('Runs', work.runs)
  if (lines.length === 1) lines.push('\n(nothing indexed yet)')
  return lines.join('\n')
}

export function buildContextToolSet(
  getBucketId: () => string,
  getWorkspaceRoot?: () => string | null | undefined,
): ToolSet {
  return {
    context_current_work: tool({
      description:
        'Summarize what Pane knows about current work in the active context bucket (tabs, pages, meetings, files, terminal, recent runs).',
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
        'Hybrid NL search (local FTS + semantic embeddings) over the context graph, memory, past chats, and indexed files. Pass the user question or a short topic — do not hand-craft long keyword lists. For "recent meetings" prefer capture_list + capture_read first.',
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe('Natural-language question or short topic to search for'),
        bucketId: z.string().optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(SEARCH_MAX_LIMIT)
          .optional()
          .describe('The top k results to return. Defaults to 10.'),
      }),
      execute: async ({ query, bucketId, limit }) => {
        const id = bucketId || getBucketId()
        const result = await hybridSearch(query, {
          bucketId: id,
          limit: limit ?? 10,
          workspaceRoot: getWorkspaceRoot?.() ?? null,
        })
        const topMemoryIds = result.hits
          .filter((c) => c.kind === 'memory' || c.sourceKind === 'memory')
          .map((c) => c.sourceId)
        if (topMemoryIds.length > 0) {
          bumpSurfaced(topMemoryIds, 1)
        }
        return { text: formatRetrieveResult(result) }
      },
    }),
    context_recall: tool({
      description:
        'Recall long-term memory notes (soul/user/memory layers) by topic tokens. Returns short snippets. Use context_search for browsing/activity/chats.',
      inputSchema: z.object({
        query: z.string().min(1),
        bucketId: z.string().optional(),
        limit: z.number().int().min(1).max(RECALL_MAX_LIMIT).optional(),
      }),
      execute: async ({ query, bucketId, limit }) => {
        const id = bucketId || getBucketId()
        const hits = listEntries({
          bucketId: id,
          query,
          status: ['active', 'demoted'],
          limit: limit ?? RECALL_DEFAULT_LIMIT,
        })
        if (hits.length === 0) {
          return { text: `No memory matches for "${query}".` }
        }
        bumpSurfaced(
          hits.map((h) => h.id),
          1,
        )
        const lines = hits.map((h, i) => {
          const snippet =
            h.content.length > RECALL_SNIPPET_MAX_CHARS
              ? `${h.content.slice(0, RECALL_SNIPPET_MAX_CHARS)}…`
              : h.content
          return `${i + 1}. [${h.layer}/${h.status}] ${snippet}`
        })
        return { text: lines.join('\n') }
      },
    }),
    session_search: tool({
      description:
        'Search past Pane chat conversations (session archive). Use when the user asks "did we discuss X?" or needs prior chat context.',
      inputSchema: z.object({
        query: z.string().min(1),
        bucketId: z.string().optional(),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      execute: async ({ query, bucketId, limit }) => {
        const id = bucketId || getBucketId()
        const tokens = contentTokens(query)
        const hits = searchChatFts(
          id,
          tokens.length ? tokens : [query],
          limit ?? 10,
        )
        if (hits.length === 0) {
          return { text: `No past chat matches for "${query}".` }
        }
        const lines = hits.map(
          (h, i) =>
            `${i + 1}. [${h.role}] session ${h.sessionId.slice(0, 8)}…\n   ${h.content.slice(0, 400)}`,
        )
        return { text: lines.join('\n') }
      },
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
