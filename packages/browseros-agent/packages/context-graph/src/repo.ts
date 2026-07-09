/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Context graph repository over Bun SQLite.
 * FTS5 uses a standalone `graph_index` table synced on write (not content=
 * binding) because graph_nodes uses text PKs.
 */

import {
  DEFAULT_BUCKET_ID,
  DEFAULT_BUCKET_KIND,
  DEFAULT_BUCKET_NAME,
  EVENT_PAYLOAD_MAX_CHARS,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  SNIPPET_MAX_CHARS,
  SUMMARY_MAX_CHARS,
} from './constants'
import type {
  AddEdgeInput,
  AddEventInput,
  Bucket,
  CurrentWork,
  GraphEdge,
  GraphEvent,
  GraphNode,
  GraphNodeKind,
  GraphSqlDatabase,
  SearchSnippet,
  UpsertNodeInput,
} from './types'

function nowMs(): number {
  return Date.now()
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

function truncate(
  value: string | null | undefined,
  max: number,
): string | null {
  if (value == null) return null
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function serializePayload(payload: Record<string, unknown> | string): string {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return truncate(raw, EVENT_PAYLOAD_MAX_CHARS) ?? '{}'
}

function rowToNode(row: Record<string, unknown>): GraphNode {
  return {
    id: String(row.id),
    bucketId: String(row.bucket_id),
    kind: row.kind as GraphNodeKind,
    title: (row.title as string | null) ?? null,
    uri: (row.uri as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    provenance: String(row.provenance),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function ensureDefaultBucket(db: GraphSqlDatabase): Bucket {
  const existing = db
    .prepare<{
      id: string
      name: string
      kind: string
      created_at: number
    }>('SELECT id, name, kind, created_at FROM buckets WHERE id = ?')
    .get(DEFAULT_BUCKET_ID)

  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      kind: existing.kind as Bucket['kind'],
      createdAt: existing.created_at,
    }
  }

  const createdAt = nowMs()
  db.prepare(
    'INSERT INTO buckets (id, name, kind, created_at) VALUES (?, ?, ?, ?)',
  ).run(DEFAULT_BUCKET_ID, DEFAULT_BUCKET_NAME, DEFAULT_BUCKET_KIND, createdAt)

  return {
    id: DEFAULT_BUCKET_ID,
    name: DEFAULT_BUCKET_NAME,
    kind: DEFAULT_BUCKET_KIND,
    createdAt,
  }
}

function syncFts(
  db: GraphSqlDatabase,
  node: Pick<GraphNode, 'id' | 'bucketId' | 'title' | 'uri' | 'summary'>,
): void {
  db.prepare('DELETE FROM graph_index WHERE node_id = ?').run(node.id)
  db.prepare(
    `INSERT INTO graph_index (node_id, bucket_id, title, uri, summary)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    node.id,
    node.bucketId,
    node.title ?? '',
    node.uri ?? '',
    node.summary ?? '',
  )
}

function removeFts(db: GraphSqlDatabase, nodeId: string): void {
  db.prepare('DELETE FROM graph_index WHERE node_id = ?').run(nodeId)
}

export function upsertNode(
  db: GraphSqlDatabase,
  input: UpsertNodeInput,
): GraphNode {
  ensureDefaultBucket(db)
  const ts = nowMs()
  const title = truncate(input.title ?? null, SNIPPET_MAX_CHARS)
  const summary = truncate(input.summary ?? null, SUMMARY_MAX_CHARS)
  const uri = input.uri ?? null

  if (input.matchByUri && uri) {
    const existing = db
      .prepare<Record<string, unknown>>(
        `SELECT * FROM graph_nodes
         WHERE bucket_id = ? AND kind = ? AND uri = ?
         LIMIT 1`,
      )
      .get(input.bucketId, input.kind, uri)

    if (existing) {
      const id = String(existing.id)
      db.prepare(
        `UPDATE graph_nodes
         SET title = COALESCE(?, title),
             summary = COALESCE(?, summary),
             provenance = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(title, summary, input.provenance, ts, id)

      const updated = db
        .prepare<Record<string, unknown>>(
          'SELECT * FROM graph_nodes WHERE id = ?',
        )
        .get(id)
      if (!updated) throw new Error(`graph node missing after update: ${id}`)
      const node = rowToNode(updated)
      syncFts(db, node)
      return node
    }
  }

  const id = input.id ?? newId('node')
  const existingById = db
    .prepare<Record<string, unknown>>('SELECT * FROM graph_nodes WHERE id = ?')
    .get(id)

  if (existingById) {
    db.prepare(
      `UPDATE graph_nodes
       SET bucket_id = ?,
           kind = ?,
           title = ?,
           uri = ?,
           summary = ?,
           provenance = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      input.bucketId,
      input.kind,
      title,
      uri,
      summary,
      input.provenance,
      ts,
      id,
    )
  } else {
    db.prepare(
      `INSERT INTO graph_nodes
         (id, bucket_id, kind, title, uri, summary, provenance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.bucketId,
      input.kind,
      title,
      uri,
      summary,
      input.provenance,
      ts,
      ts,
    )
  }

  const row = db
    .prepare<Record<string, unknown>>('SELECT * FROM graph_nodes WHERE id = ?')
    .get(id)
  if (!row) throw new Error(`graph node missing after upsert: ${id}`)
  const node = rowToNode(row)
  syncFts(db, node)
  return node
}

export function addEdge(db: GraphSqlDatabase, input: AddEdgeInput): GraphEdge {
  ensureDefaultBucket(db)
  const id = input.id ?? newId('edge')
  const createdAt = nowMs()
  db.prepare(
    `INSERT INTO graph_edges (id, bucket_id, from_id, to_id, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.bucketId, input.fromId, input.toId, input.kind, createdAt)

  return {
    id,
    bucketId: input.bucketId,
    fromId: input.fromId,
    toId: input.toId,
    kind: input.kind,
    createdAt,
  }
}

export function addEvent(
  db: GraphSqlDatabase,
  input: AddEventInput,
): GraphEvent {
  ensureDefaultBucket(db)
  const id = input.id ?? newId('evt')
  const createdAt = nowMs()
  const payloadJson = serializePayload(input.payload)
  db.prepare(
    `INSERT INTO graph_events
       (id, bucket_id, run_id, tool_name, node_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.bucketId,
    input.runId ?? null,
    input.toolName ?? null,
    input.nodeId ?? null,
    payloadJson,
    createdAt,
  )

  return {
    id,
    bucketId: input.bucketId,
    runId: input.runId ?? null,
    toolName: input.toolName ?? null,
    nodeId: input.nodeId ?? null,
    payloadJson,
    createdAt,
  }
}

/**
 * FTS5 search. Query is bound as a parameter (never concatenated into SQL).
 * Uses MATCH with a sanitized query string for safety.
 */
export function search(
  db: GraphSqlDatabase,
  bucketId: string,
  query: string,
  limit = SEARCH_DEFAULT_LIMIT,
  options?: { deniedHosts?: Set<string> | string[] },
): SearchSnippet[] {
  const capped = Math.min(Math.max(1, limit), SEARCH_MAX_LIMIT)
  const matchQuery = toFtsMatchQuery(query)
  if (!matchQuery) return []

  // FTS5 MATCH must target the virtual table name (not an alias).
  const rows = db
    .prepare<{
      node_id: string
      bucket_id: string
      kind: string
      title: string | null
      uri: string | null
      snippet: string
    }>(
      `SELECT
         graph_index.node_id AS node_id,
         graph_index.bucket_id AS bucket_id,
         n.kind AS kind,
         n.title AS title,
         n.uri AS uri,
         snippet(graph_index, 4, '', '', '…', 64) AS snippet
       FROM graph_index
       JOIN graph_nodes AS n ON n.id = graph_index.node_id
       WHERE graph_index.bucket_id = ?
         AND graph_index MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(bucketId, matchQuery, capped)

  const denied = normalizeDeniedHosts(options?.deniedHosts)
  const out: SearchSnippet[] = []
  for (const row of rows) {
    if (denied.size > 0 && isDeniedUri(row.uri, denied)) continue
    out.push({
      nodeId: row.node_id,
      bucketId: row.bucket_id,
      kind: row.kind as GraphNodeKind,
      title: row.title,
      uri: row.uri,
      snippet:
        truncate(
          row.snippet || row.title || row.uri || '',
          SNIPPET_MAX_CHARS,
        ) ?? '',
    })
  }
  return out
}

export function currentWork(
  db: GraphSqlDatabase,
  bucketId: string,
  options?: { deniedHosts?: Set<string> | string[]; limitPerKind?: number },
): CurrentWork {
  const limit = options?.limitPerKind ?? 8
  const denied = normalizeDeniedHosts(options?.deniedHosts)

  const pick = (kind: GraphNodeKind): GraphNode[] => {
    const rows = db
      .prepare<Record<string, unknown>>(
        `SELECT * FROM graph_nodes
         WHERE bucket_id = ? AND kind = ?
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(bucketId, kind, limit * 2)

    const nodes: GraphNode[] = []
    for (const row of rows) {
      const node = rowToNode(row)
      if (
        (kind === 'page' || kind === 'tab') &&
        denied.size > 0 &&
        isDeniedUri(node.uri, denied)
      ) {
        continue
      }
      nodes.push(node)
      if (nodes.length >= limit) break
    }
    return nodes
  }

  return {
    tabs: pick('tab'),
    pages: pick('page'),
    files: pick('file'),
    runs: pick('agent_run'),
    terminal: pick('terminal_session'),
  }
}

export function getNode(
  db: GraphSqlDatabase,
  nodeId: string,
): GraphNode | null {
  const row = db
    .prepare<Record<string, unknown>>('SELECT * FROM graph_nodes WHERE id = ?')
    .get(nodeId)
  return row ? rowToNode(row) : null
}

export function deleteNode(db: GraphSqlDatabase, nodeId: string): void {
  removeFts(db, nodeId)
  db.prepare('DELETE FROM graph_edges WHERE from_id = ? OR to_id = ?').run(
    nodeId,
    nodeId,
  )
  db.prepare('UPDATE graph_events SET node_id = NULL WHERE node_id = ?').run(
    nodeId,
  )
  db.prepare('DELETE FROM graph_nodes WHERE id = ?').run(nodeId)
}

/** Build a safe FTS5 MATCH query from free text (no raw SQL concat of user input). */
export function toFtsMatchQuery(raw: string): string | null {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["'*(){}[\]^~:]+/g, ''))
    .filter((t) => t.length > 0)
  if (tokens.length === 0) return null
  // Prefix match each token; quote to avoid FTS operators from user text.
  return tokens.map((t) => `"${t}"*`).join(' ')
}

function normalizeDeniedHosts(denied?: Set<string> | string[]): Set<string> {
  if (!denied) return new Set()
  const set = denied instanceof Set ? denied : new Set(denied)
  const out = new Set<string>()
  for (const h of set) out.add(h.toLowerCase())
  return out
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

export type {
  Bucket,
  CurrentWork,
  GraphEdge,
  GraphEvent,
  GraphNode,
  SearchSnippet,
}
