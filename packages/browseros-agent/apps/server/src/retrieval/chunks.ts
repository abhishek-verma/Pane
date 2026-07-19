/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { RetrievalSourceKind, VectorHit } from '@browseros/retrieval/types'
import {
  cosineSimilarity,
  packEmbedding,
  unpackEmbedding,
} from '@browseros/retrieval/vector'
import { getDbHandle } from '../lib/db'

function now(): number {
  return Date.now()
}

export interface ChunkInput {
  bucketId: string
  sourceKind: RetrievalSourceKind | string
  sourceId: string
  kind: string
  title?: string | null
  uri?: string | null
  text: string
  embedding: Float32Array
}

export function upsertChunk(input: ChunkInput): string {
  const id = `${input.sourceKind}:${input.sourceId}`
  const ts = now()
  const db = getDbHandle().sqlite
  db.prepare(
    `INSERT INTO embedding_chunks (
      id, bucket_id, source_kind, source_id, kind, title, uri, text, dims, embedding, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      bucket_id = excluded.bucket_id,
      kind = excluded.kind,
      title = excluded.title,
      uri = excluded.uri,
      text = excluded.text,
      dims = excluded.dims,
      embedding = excluded.embedding,
      updated_at = excluded.updated_at`,
  ).run(
    id,
    input.bucketId,
    input.sourceKind,
    input.sourceId,
    input.kind,
    input.title ?? null,
    input.uri ?? null,
    input.text,
    input.embedding.length,
    packEmbedding(input.embedding),
    ts,
    ts,
  )
  return id
}

export function deleteChunksForSource(
  sourceKind: string,
  sourceId: string,
): void {
  getDbHandle()
    .sqlite.prepare(
      `DELETE FROM embedding_chunks WHERE source_kind = ? AND source_id = ?`,
    )
    .run(sourceKind, sourceId)
}

function isDeniedUri(uri: string | null, denied: Set<string>): boolean {
  if (!uri || denied.size === 0) return false
  try {
    const host = new URL(uri).hostname.toLowerCase()
    if (denied.has(host)) return true
    for (const d of denied) {
      if (host === d || host.endsWith(`.${d}`)) return true
    }
    return false
  } catch {
    return false
  }
}

/** Brute-force cosine search (sqlite-vec-compatible blob layout). */
export function searchChunks(
  bucketId: string,
  queryVec: Float32Array,
  limit: number,
  options?: { deniedHosts?: Set<string> | string[] },
): VectorHit[] {
  const denied = new Set(
    [...(options?.deniedHosts ?? [])].map((h) => h.toLowerCase()),
  )
  const rows = getDbHandle()
    .sqlite.prepare(
      `SELECT id, bucket_id, source_kind, source_id, kind, title, uri, text, embedding
       FROM embedding_chunks
       WHERE bucket_id = ?`,
    )
    .all(bucketId) as Array<{
    id: string
    source_kind: string
    source_id: string
    kind: string
    title: string | null
    uri: string | null
    text: string
    embedding: Buffer
  }>

  const scored: VectorHit[] = []
  for (const row of rows) {
    if (isDeniedUri(row.uri, denied)) continue
    const vec = unpackEmbedding(row.embedding)
    const score = cosineSimilarity(queryVec, vec)
    if (score <= 0) continue
    scored.push({
      id: row.id,
      sourceId: row.source_id,
      sourceKind: 'embedding',
      kind: row.kind,
      title: row.title,
      uri: row.uri,
      snippet: row.text.slice(0, 500),
      score,
    })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

/** Delete all embedding chunks for a chat session (uri = chat:&lt;sessionId&gt;). */
export function deleteChunksForChatSession(sessionId: string): void {
  getDbHandle()
    .sqlite.prepare(
      `DELETE FROM embedding_chunks WHERE source_kind = 'chat' AND uri = ?`,
    )
    .run(`chat:${sessionId}`)
}

export function chunkCount(bucketId?: string): number {
  if (bucketId) {
    const row = getDbHandle()
      .sqlite.prepare(
        `SELECT COUNT(*) AS c FROM embedding_chunks WHERE bucket_id = ?`,
      )
      .get(bucketId) as { c: number }
    return row.c
  }
  const row = getDbHandle()
    .sqlite.prepare(`SELECT COUNT(*) AS c FROM embedding_chunks`)
    .get() as { c: number }
  return row.c
}
