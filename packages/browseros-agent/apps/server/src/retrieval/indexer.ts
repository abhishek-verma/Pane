/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Idle-priority embed queue drain + backfill from graph/memory/chat.
 */

import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { hashEmbed } from '@browseros/retrieval/hash-embed'
import { getPauseOnBatteryPref } from '../context/battery'
import { getDbHandle } from '../lib/db'
import { forEachKnownProfile } from '../lib/for-each-profile'
import { logger } from '../lib/logger'
import { extractChatPlainText } from './chat-text'
import { upsertChunk } from './chunks'
import { createEmbedClient } from './embed-client'
import {
  claimPending,
  enqueueEmbed,
  markDone,
  markFailed,
  pendingCount,
} from './queue'

export { extractChatPlainText }

let timer: ReturnType<typeof setInterval> | null = null
let draining = false
let paused = false

/** Detect on-battery via existing ingest pause preference path. */
async function shouldPauseForBudget(): Promise<boolean> {
  if (paused) return true
  if (!getPauseOnBatteryPref()) return false
  // Reuse pmset indirectly: if ingest was paused for battery, skip embeds too.
  try {
    const { isIngestPaused } = await import('../context/ingest')
    return isIngestPaused()
  } catch {
    return false
  }
}

export function setEmbedIndexerPaused(value: boolean): void {
  paused = value
}

export async function drainEmbedQueue(batchSize = 8): Promise<number> {
  if (draining) return 0
  if (await shouldPauseForBudget()) return 0
  draining = true
  let processed = 0
  try {
    const items = claimPending(batchSize)
    if (items.length === 0) return 0
    const client = createEmbedClient()
    for (const item of items) {
      try {
        const vec = await client.embed(item.text, 5_000)
        if (!vec) {
          // Still index with hash so semantic arm is never empty.
          const fallback = hashEmbed(item.text)
          upsertChunk({
            bucketId: item.bucketId,
            sourceKind: item.sourceKind,
            sourceId: item.sourceId,
            kind: item.kind,
            title: item.title,
            uri: item.uri,
            text: item.text,
            embedding: fallback,
          })
        } else {
          upsertChunk({
            bucketId: item.bucketId,
            sourceKind: item.sourceKind,
            sourceId: item.sourceId,
            kind: item.kind,
            title: item.title,
            uri: item.uri,
            text: item.text,
            embedding: vec,
          })
        }
        markDone(item.id)
        processed++
      } catch (err) {
        logger.warn('embed queue item failed', {
          id: item.id,
          err: String(err),
        })
        markFailed(item.id)
      }
    }
  } finally {
    draining = false
  }
  return processed
}

/** Enqueue existing graph nodes + memory + chats that lack chunks. */
export function backfillEmbedQueue(limit = 200): number {
  const db = getDbHandle().sqlite
  let enqueued = 0

  const nodes = db
    .prepare(
      `SELECT n.id, n.bucket_id, n.kind, n.title, n.uri, n.summary
       FROM graph_nodes n
       LEFT JOIN embedding_chunks c
         ON c.source_kind = 'graph' AND c.source_id = n.id
       WHERE c.id IS NULL
         AND (n.summary IS NOT NULL OR n.title IS NOT NULL)
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string
    bucket_id: string
    kind: string
    title: string | null
    uri: string | null
    summary: string | null
  }>

  for (const n of nodes) {
    const text = [n.title, n.uri, n.summary].filter(Boolean).join('\n')
    if (!text.trim()) continue
    enqueueEmbed({
      bucketId: n.bucket_id,
      sourceKind: 'graph',
      sourceId: n.id,
      kind: n.kind,
      title: n.title,
      uri: n.uri,
      text,
    })
    enqueued++
  }

  const memories = db
    .prepare(
      `SELECT m.id, m.bucket_id, m.layer, m.content
       FROM memory_entries m
       LEFT JOIN embedding_chunks c
         ON c.source_kind = 'memory' AND c.source_id = m.id
       WHERE c.id IS NULL AND m.status IN ('active', 'demoted')
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string
    bucket_id: string
    layer: string
    content: string
  }>

  for (const m of memories) {
    enqueueEmbed({
      bucketId: m.bucket_id || DEFAULT_BUCKET_ID,
      sourceKind: 'memory',
      sourceId: m.id,
      kind: `memory:${m.layer}`,
      title: `Memory: ${m.layer}`,
      text: m.content,
    })
    enqueued++
  }

  const chats = db
    .prepare(
      `SELECT id, session_id, role, content
       FROM chat_messages
       WHERE role IN ('user', 'assistant')
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string
    session_id: string
    role: string
    content: string
  }>

  for (const msg of chats) {
    const text = extractChatPlainText(msg.content)
    if (!text || text.length < 20) continue
    const existing = db
      .prepare(
        `SELECT id FROM embedding_chunks WHERE source_kind = 'chat' AND source_id = ?`,
      )
      .get(msg.id)
    if (existing) continue
    enqueueEmbed({
      bucketId: DEFAULT_BUCKET_ID,
      sourceKind: 'chat',
      sourceId: msg.id,
      kind: 'chat',
      title: `${msg.role} · ${msg.session_id.slice(0, 8)}`,
      uri: `chat:${msg.session_id}`,
      text,
    })
    enqueued++
  }

  return enqueued
}

export function startEmbedIndexer(): void {
  if (timer) return
  // Initial backfill + drain shortly after boot (per Chrome profile)
  setTimeout(() => {
    void forEachKnownProfile(async () => {
      try {
        const n = backfillEmbedQueue()
        if (n > 0) logger.info('Embed backfill enqueued', { n })
      } catch (err) {
        logger.warn('Embed backfill failed', { err: String(err) })
      }
      await drainEmbedQueue().catch((err: unknown) => {
        logger.warn('Embed drain failed', { err: String(err) })
      })
    })
  }, 5_000)

  timer = setInterval(() => {
    void forEachKnownProfile(async () => {
      await drainEmbedQueue().catch((err: unknown) => {
        logger.warn('Embed drain failed', { err: String(err) })
      })
      if (pendingCount() < 4) {
        try {
          backfillEmbedQueue(50)
        } catch {
          /* ignore */
        }
      }
    })
  }, 15_000)
  // Don't keep process alive solely for indexer in tests
  timer.unref?.()
}

export function stopEmbedIndexer(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
