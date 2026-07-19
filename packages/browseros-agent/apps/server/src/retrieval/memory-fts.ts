/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { toOrFtsMatchQuery } from '@browseros/retrieval/fts'
import { getDbHandle } from '../lib/db'

export function syncMemoryFts(entry: {
  id: string
  bucketId: string
  layer: string
  content: string
}): void {
  const db = getDbHandle().sqlite
  db.prepare(`DELETE FROM memory_index WHERE entry_id = ?`).run(entry.id)
  db.prepare(
    `INSERT INTO memory_index (entry_id, bucket_id, layer, content) VALUES (?, ?, ?, ?)`,
  ).run(entry.id, entry.bucketId, entry.layer, entry.content)
}

export function removeMemoryFts(entryId: string): void {
  getDbHandle()
    .sqlite.prepare(`DELETE FROM memory_index WHERE entry_id = ?`)
    .run(entryId)
}

export function searchMemoryFts(
  bucketId: string,
  tokens: string[],
  limit: number,
): Array<{
  id: string
  layer: string
  content: string
}> {
  const match = toOrFtsMatchQuery(tokens)
  if (!match) return []
  const rows = getDbHandle()
    .sqlite.prepare(
      `SELECT memory_index.entry_id AS id, memory_index.layer AS layer, memory_index.content AS content
       FROM memory_index
       WHERE memory_index.bucket_id = ?
         AND memory_index MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(bucketId, match, limit) as Array<{
    id: string
    layer: string
    content: string
  }>
  return rows
}

/** Rebuild memory_index from memory_entries (upgrade / repair). */
export function rebuildMemoryFts(): number {
  const db = getDbHandle().sqlite
  db.prepare(`DELETE FROM memory_index`).run()
  const rows = db
    .prepare(
      `SELECT id, bucket_id, layer, content FROM memory_entries WHERE status IN ('active', 'demoted')`,
    )
    .all() as Array<{
    id: string
    bucket_id: string
    layer: string
    content: string
  }>
  const insert = db.prepare(
    `INSERT INTO memory_index (entry_id, bucket_id, layer, content) VALUES (?, ?, ?, ?)`,
  )
  for (const r of rows) {
    insert.run(r.id, r.bucket_id, r.layer, r.content)
  }
  return rows.length
}
