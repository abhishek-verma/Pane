/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { assertMemoryContent } from '@browseros/memory/scan'
import { getDeniedHosts } from '../context/grants'
import { graphAddEdge, graphAddEvent, graphUpsertNode } from '../context/repo'
import { getDbHandle } from '../lib/db'
import { writeStagedSkill } from '../memory/files'
import { upsertSkillRecord } from '../memory/store'
import { getCapturePausedReason } from './performance'

function isUrlDenied(url: string, bucketId: string): boolean {
  const denied = getDeniedHosts(bucketId)
  if (denied.size === 0) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (denied.has(host)) return true
    for (const d of denied) {
      if (host === d || host.endsWith(`.${d}`)) return true
    }
    return false
  } catch {
    return false
  }
}

export interface BrowsingObservationInput {
  url: string
  title?: string
  text: string
  bucketId?: string
  capturedAt?: number
}

export interface ResearchPageInput extends BrowsingObservationInput {
  threadId?: string
  topic?: string
  quote?: string
}

export async function observeBrowsingLearning(
  input: BrowsingObservationInput,
): Promise<{ stagedSkillId: string | null; skippedReason?: string }> {
  if (getCapturePausedReason())
    return { stagedSkillId: null, skippedReason: 'paused' }
  const bucketId = input.bucketId ?? DEFAULT_BUCKET_ID
  if (isUrlDenied(input.url, bucketId)) {
    return { stagedSkillId: null, skippedReason: 'denied' }
  }
  const digest = extractDeterministicLearning(input)
  if (!digest) return { stagedSkillId: null, skippedReason: 'no-learning' }
  assertMemoryContent(digest)
  const stagedSkillId = `capture-learning-${crypto.randomUUID()}`
  const body = `---
name: Browsing learning from ${new URL(input.url).hostname}
description: Capture-derived workflow candidate staged for review.
---

# Browsing Learning

Source: ${input.url}

${digest}
`
  await writeStagedSkill(stagedSkillId, body)
  upsertSkillRecord({
    id: stagedSkillId,
    name: `Browsing learning: ${input.title ?? new URL(input.url).hostname}`,
    description: 'Capture-derived workflow candidate staged for review.',
    provenance: 'agent-written',
    sourceRun: 'capture:browsing',
    bucketId,
    status: 'staged',
  })
  graphAddEvent({
    bucketId,
    toolName: 'capture_observe_browsing',
    payload: { url: input.url, title: input.title, stagedSkillId },
  })
  return { stagedSkillId }
}

export function recordResearchPage(input: ResearchPageInput): {
  threadId: string
  nodeId: string
} {
  const bucketId = input.bucketId ?? DEFAULT_BUCKET_ID
  if (isUrlDenied(input.url, bucketId))
    throw new Error('Research capture is off for this domain')
  const now = input.capturedAt ?? Date.now()
  const threadId = input.threadId ?? crypto.randomUUID()
  ensureResearchThread(threadId, bucketId, input.topic, now)
  const node = graphUpsertNode({
    id: `research-page:${crypto.randomUUID()}`,
    bucketId,
    kind: 'research_page',
    title: input.title,
    uri: input.url,
    summary: input.quote ?? input.text.slice(0, 500),
    provenance: 'capture:research',
  })
  const orderIndex = nextResearchOrder(threadId)
  getDbHandle()
    .sqlite.prepare(
      `INSERT INTO research_thread_pages
       (thread_id, node_id, order_index, quote, url, captured_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(threadId, node.id, orderIndex, input.quote ?? null, input.url, now)
  graphAddEdge({
    bucketId,
    fromId: `research-thread:${threadId}`,
    toId: node.id,
    kind: 'opened_from',
  })
  graphAddEvent({
    bucketId,
    toolName: 'capture_research_page',
    nodeId: node.id,
    payload: { threadId, url: input.url, quote: input.quote, capturedAt: now },
  })
  return { threadId, nodeId: node.id }
}

function extractDeterministicLearning(
  input: BrowsingObservationInput,
): string | null {
  const headings = input.text
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) => /^#{1,3}\s+/.test(line) || /^[A-Z][^.!?]{8,80}$/.test(line),
    )
    .slice(0, 5)
  if (headings.length === 0) return null
  return [
    'The user repeatedly encountered these page structure signals:',
    ...headings.map((heading) => `- ${heading.replace(/^#+\s*/, '')}`),
  ].join('\n')
}

function ensureResearchThread(
  threadId: string,
  bucketId: string,
  topic: string | undefined,
  now: number,
): void {
  graphUpsertNode({
    id: `research-thread:${threadId}`,
    bucketId,
    kind: 'research_thread',
    title: topic ?? 'Research thread',
    summary: topic ?? 'Active research thread',
    provenance: 'capture:research',
  })
  getDbHandle()
    .sqlite.prepare(
      `INSERT INTO research_threads (id, bucket_id, topic, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .run(threadId, bucketId, topic ?? null, now, now)
}

function nextResearchOrder(threadId: string): number {
  const row = getDbHandle()
    .sqlite.prepare<{ n: number }, [string]>(
      `SELECT COUNT(*) as n FROM research_thread_pages WHERE thread_id = ?`,
    )
    .get(threadId)
  return row?.n ?? 0
}
