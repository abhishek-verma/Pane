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
import { PROMOTED_ARG } from '@browseros/shared/trust/consequence-class'
import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { lookupResearchCitation } from '../capture/research-citations'
import { bumpSurfaced, listEntries } from '../memory/store'
import { getDeniedHosts } from './grants'
import { graphCurrentWork, graphSearch } from './repo'
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

export function buildContextToolSet(getBucketId: () => string): ToolSet {
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
        'Keyword/FTS search over the local context graph (browsing, research, meeting excerpts, files, sessions) and memory. Returns top-k matching snippets — not semantic embeddings. For "recent meetings" prefer capture_list + capture_read first.',
      inputSchema: z.object({
        query: z.string().min(1),
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
        const denied = getDeniedHosts(id)
        const k = limit ?? 10

        // 1. Fetch from context graph FTS5
        const graphHits = graphSearch(id, query, k * 2, {
          deniedHosts: denied,
        })

        // 2. Fetch from memory
        const memoryHits = listEntries({
          bucketId: id,
          query,
          status: ['active', 'demoted'],
          limit: k * 2,
        })

        interface Candidate {
          id: string
          kind: string
          title: string | null
          uri: string | null
          snippet: string
          metadata?: string
        }

        const candidates: Candidate[] = []

        for (const h of graphHits) {
          const citation =
            h.kind === 'research_page' ? lookupResearchCitation(h.nodeId) : null
          const metadata = citation
            ? JSON.stringify({
                url: citation.url,
                quote: citation.quote,
                capturedAt: citation.capturedAt,
              })
            : undefined

          candidates.push({
            id: h.nodeId,
            kind: h.kind,
            title: h.title,
            uri: h.uri,
            snippet: h.snippet,
            metadata,
          })
        }

        for (const h of memoryHits) {
          candidates.push({
            id: h.id,
            kind: 'memory',
            title: `Memory: ${h.layer}`,
            uri: null,
            snippet: h.content,
          })
        }

        if (candidates.length === 0) {
          return { text: `No context or memory matches for "${query}".` }
        }

        // Lightweight TF-IDF similarity scoring
        const queryText = query.toLowerCase().trim()
        const queryWords = queryText.split(/\s+/).filter(Boolean)

        const computeScore = (c: Candidate) => {
          if (queryWords.length === 0) return 0
          const title = (c.title || '').toLowerCase()
          const snippet = (c.snippet || '').toLowerCase()
          const uri = (c.uri || '').toLowerCase()
          const fullText = `${title} ${snippet} ${uri}`

          let score = 0
          if (fullText.includes(queryText)) {
            score += 10
          }
          let matched = 0
          for (const word of queryWords) {
            if (fullText.includes(word)) {
              matched++
              if (title.includes(word)) {
                score += 2
              } else {
                score += 1
              }
            }
          }
          score += (matched / queryWords.length) * 5
          return score
        }

        const ranked = candidates
          .map((c) => ({ candidate: c, score: computeScore(c) }))
          .sort((a, b) => b.score - a.score)

        // Increment usefulness for memory hits that made it to top k
        const topK = ranked.slice(0, k).map((r) => r.candidate)
        const topMemoryIds = topK
          .filter((c) => c.kind === 'memory')
          .map((c) => c.id)
        if (topMemoryIds.length > 0) {
          bumpSurfaced(topMemoryIds, 1)
        }

        const lines = topK.map((c, i) => {
          const citationLine = c.metadata ? `\n   citation: ${c.metadata}` : ''
          return `${i + 1}. [${c.kind}] ${c.title ?? '(untitled)'}${c.uri ? ` — ${c.uri}` : ''}\n   ${c.snippet}${citationLine}`
        })

        return { text: lines.join('\n') }
      },
    }),
    context_recall: tool({
      description:
        'Recall long-term memory notes (soul/user/memory layers). Returns short snippets. Use context_search for browsing/activity.',
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
