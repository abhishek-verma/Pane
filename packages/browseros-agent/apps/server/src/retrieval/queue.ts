/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getDbHandle } from '../lib/db'

function now(): number {
  return Date.now()
}

export interface EmbedQueueItem {
  id: string
  bucketId: string
  sourceKind: string
  sourceId: string
  kind: string
  title: string | null
  uri: string | null
  text: string
  status: string
  attempts: number
}

export function enqueueEmbed(input: {
  bucketId: string
  sourceKind: string
  sourceId: string
  kind: string
  title?: string | null
  uri?: string | null
  text: string
}): void {
  const trimmed = input.text.trim()
  if (!trimmed) return
  const id = `${input.sourceKind}:${input.sourceId}`
  const ts = now()
  getDbHandle()
    .sqlite.prepare(
      `INSERT INTO embed_queue (
        id, bucket_id, source_kind, source_id, kind, title, uri, text, status, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        bucket_id = excluded.bucket_id,
        kind = excluded.kind,
        title = excluded.title,
        uri = excluded.uri,
        text = excluded.text,
        status = 'pending',
        updated_at = excluded.updated_at`,
    )
    .run(
      id,
      input.bucketId,
      input.sourceKind,
      input.sourceId,
      input.kind,
      input.title ?? null,
      input.uri ?? null,
      trimmed.slice(0, 8000),
      ts,
      ts,
    )
}

/** Reclaim rows stuck in processing after a crash (older than 2 minutes). */
export function reclaimStaleProcessing(staleMs = 120_000): number {
  const cutoff = now() - staleMs
  const result = getDbHandle()
    .sqlite.prepare(
      `UPDATE embed_queue
       SET status = 'pending', updated_at = ?
       WHERE status = 'processing' AND updated_at < ?`,
    )
    .run(now(), cutoff)
  return Number(result.changes ?? 0)
}

export function claimPending(limit = 8): EmbedQueueItem[] {
  reclaimStaleProcessing()
  const db = getDbHandle().sqlite
  const rows = db
    .prepare(
      `SELECT id, bucket_id, source_kind, source_id, kind, title, uri, text, status, attempts
       FROM embed_queue
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string
    bucket_id: string
    source_kind: string
    source_id: string
    kind: string
    title: string | null
    uri: string | null
    text: string
    status: string
    attempts: number
  }>

  const ts = now()
  const mark = db.prepare(
    `UPDATE embed_queue SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ?`,
  )
  for (const r of rows) {
    mark.run(ts, r.id)
  }

  return rows.map((r) => ({
    id: r.id,
    bucketId: r.bucket_id,
    sourceKind: r.source_kind,
    sourceId: r.source_id,
    kind: r.kind,
    title: r.title,
    uri: r.uri,
    text: r.text,
    status: 'processing',
    attempts: r.attempts + 1,
  }))
}

export function markDone(id: string): void {
  getDbHandle()
    .sqlite.prepare(
      `UPDATE embed_queue SET status = 'done', updated_at = ? WHERE id = ?`,
    )
    .run(now(), id)
}

export function markFailed(id: string): void {
  getDbHandle()
    .sqlite.prepare(
      `UPDATE embed_queue SET status = 'pending', updated_at = ? WHERE id = ? AND attempts < 5`,
    )
    .run(now(), id)
  getDbHandle()
    .sqlite.prepare(
      `UPDATE embed_queue SET status = 'failed', updated_at = ? WHERE id = ? AND attempts >= 5`,
    )
    .run(now(), id)
}

export function pendingCount(): number {
  const row = getDbHandle()
    .sqlite.prepare(
      `SELECT COUNT(*) AS c FROM embed_queue WHERE status = 'pending'`,
    )
    .get() as { c: number }
  return row.c
}
