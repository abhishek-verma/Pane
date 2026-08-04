/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Indexes durable PI pages and records into the pi_index FTS table and
 * the embed_queue for semantic retrieval. On archive/delete the index rows
 * are removed so context_search never surfaces stale PI content.
 */

import { getDbHandle } from '../lib/db'
import { enqueueEmbed } from '../retrieval/queue'
import type { PiNode, PiPageDoc } from './types'

// ---------------------------------------------------------------------------
// Text extraction from DSL nodes
// ---------------------------------------------------------------------------

function extractNodeText(node: PiNode): string {
  switch (node.type) {
    case 'title':
    case 'text':
    case 'note':
      return node.text
    case 'badge':
      return node.text
    case 'stat':
      return [node.label, node.value].join(' ')
    case 'button':
      return node.label
    case 'link':
      return node.label
    case 'divider':
      return ''
    case 'stack':
      return node.children.map(extractNodeText).join(' ')
    case 'table': {
      const cellTexts: string[] = []
      for (const row of node.rows) {
        for (const cell of Object.values(row.cells)) {
          cellTexts.push(
            typeof cell === 'string' ? cell : extractNodeText(cell),
          )
        }
      }
      return cellTexts.join(' ')
    }
    case 'board':
      return node.cards
        .map((c) => [c.title, c.subtitle ?? ''].join(' '))
        .join(' ')
    case 'chart':
      return [
        node.title ?? '',
        node.unit ?? '',
        ...node.data.map((d) => d.label),
      ]
        .filter(Boolean)
        .join(' ')
    case 'mermaid':
      return [node.title ?? '', node.source].filter(Boolean).join(' ')
    case 'svg':
      return [node.title ?? '', node.alt ?? ''].filter(Boolean).join(' ')
    default:
      return ''
  }
}

/** Flatten a page document into plain text for indexing. */
export function extractPageText(doc: PiPageDoc): string {
  const parts = [doc.title, ...doc.nodes.map(extractNodeText)]
  return parts.filter(Boolean).join('\n').trim()
}

/** Flatten record type + data values into plain text for indexing. */
export function extractRecordText(
  type: string,
  data: Record<string, unknown>,
): string {
  const values = Object.values(data)
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .map(String)
  return [type, ...values].filter(Boolean).join(' ').trim()
}

// ---------------------------------------------------------------------------
// pi_index FTS helpers
// ---------------------------------------------------------------------------

function syncPiFts(entry: {
  id: string
  bucketId: string
  sourceKind: 'pi_page' | 'pi_record'
  siteId: string | null
  uri: string | null
  title: string | null
  content: string
}): void {
  if (!entry.content.trim()) return
  const db = getDbHandle().sqlite
  db.prepare(`DELETE FROM pi_index WHERE entry_id = ?`).run(entry.id)
  db.prepare(
    `INSERT INTO pi_index (entry_id, bucket_id, source_kind, site_id, uri, title, content)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.bucketId,
    entry.sourceKind,
    entry.siteId,
    entry.uri,
    entry.title,
    entry.content,
  )
}

function removePiFts(id: string): void {
  getDbHandle()
    .sqlite.prepare(`DELETE FROM pi_index WHERE entry_id = ?`)
    .run(id)
}

// ---------------------------------------------------------------------------
// embed_queue removal (complement to enqueueEmbed upsert)
// ---------------------------------------------------------------------------

function dequeueEmbed(sourceKind: string, sourceId: string): void {
  const db = getDbHandle().sqlite
  const id = `${sourceKind}:${sourceId}`
  db.prepare(`DELETE FROM embed_queue WHERE id = ?`).run(id)
  db.prepare(
    `DELETE FROM embedding_chunks WHERE source_kind = ? AND source_id = ?`,
  ).run(sourceKind, sourceId)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Index a durable PI page into pi_index (FTS) and the embed queue.
 * Safe to call on every write; uses upsert semantics.
 */
export function indexPiPage(
  pageId: string,
  bucketId: string,
  siteId: string | null,
  title: string,
  doc: PiPageDoc,
): void {
  const content = extractPageText(doc)
  if (!content) return

  const uri = siteId ? `pi:page:${siteId}:${pageId}` : `pi:page:${pageId}`

  syncPiFts({
    id: pageId,
    bucketId,
    sourceKind: 'pi_page',
    siteId,
    uri,
    title,
    content,
  })

  enqueueEmbed({
    bucketId,
    sourceKind: 'pi_page',
    sourceId: pageId,
    kind: 'pi_page',
    title,
    uri,
    text: content,
  })
}

/**
 * Index a PI record into pi_index (FTS) and the embed queue.
 * Safe to call on every write; uses upsert semantics.
 */
export function indexPiRecord(
  recordId: string,
  siteId: string,
  bucketId: string,
  type: string,
  data: Record<string, unknown>,
): void {
  const content = extractRecordText(type, data)
  if (!content) return

  const uri = `pi:record:${siteId}:${recordId}`
  const title = `${type}: ${String(data.name ?? data.title ?? data.company ?? recordId)}`

  syncPiFts({
    id: recordId,
    bucketId,
    sourceKind: 'pi_record',
    siteId,
    uri,
    title,
    content,
  })

  enqueueEmbed({
    bucketId,
    sourceKind: 'pi_record',
    sourceId: recordId,
    kind: `pi_record:${type}`,
    title,
    uri,
    text: content,
  })
}

/**
 * Remove a single page or record from pi_index FTS and embedding chunks/queue.
 */
export function removePiIndex(
  id: string,
  sourceKind: 'pi_page' | 'pi_record',
): void {
  removePiFts(id)
  dequeueEmbed(sourceKind, id)
}

/**
 * Remove all index entries for every page and record belonging to a site.
 * Called on archive-site so stale PI content never surfaces in retrieval.
 */
export function removePiSiteIndex(siteId: string): void {
  const db = getDbHandle().sqlite

  // Query pi_index by site_id UNINDEXED column to find all entries for the site.
  const indexed = db
    .prepare(
      `SELECT entry_id AS id, source_kind AS sourceKind
       FROM pi_index WHERE site_id = ?`,
    )
    .all(siteId) as Array<{ id: string; sourceKind: string }>

  for (const row of indexed) {
    removePiFts(row.id)
    dequeueEmbed(row.sourceKind, row.id)
  }
}

export interface PiFtsHit {
  id: string
  sourceKind: string
  uri: string | null
  title: string | null
  /** Raw text content from the FTS index. */
  content: string
  /** Alias for content; used by hybrid search to build snippets. */
  snippet: string
}

/** Search the pi_index FTS table; returns raw rows for use by hybrid search. */
export function searchPiFts(
  bucketId: string,
  match: string,
  limit: number,
): PiFtsHit[] {
  const rows = getDbHandle()
    .sqlite.prepare(
      `SELECT entry_id AS id, source_kind AS sourceKind, uri, title, content
       FROM pi_index
       WHERE bucket_id = ?
         AND pi_index MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(bucketId, match, limit) as Array<{
    id: string
    sourceKind: string
    uri: string | null
    title: string | null
    content: string
    snippet?: string
  }>
  return rows.map((r) => ({ ...r, snippet: r.content }))
}
