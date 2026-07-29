/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type RetrievalSourceKind =
  | 'graph'
  | 'memory'
  | 'chat'
  | 'file_path'
  | 'embedding'
  | 'pi_page'
  | 'pi_record'

export type RetrievalHint =
  | 'temporal'
  | 'memory_fact'
  | 'past_chat'
  | 'file_name'

export interface NormalizedQuery {
  raw: string
  /** Content tokens for FTS (stopwords removed). */
  tokens: string[]
  /** Cleaned NL string for query embedding. */
  embedText: string
  hints: RetrievalHint[]
}

export interface RankedHit {
  id: string
  sourceKind: RetrievalSourceKind
  kind: string
  title: string | null
  uri: string | null
  snippet: string
  score: number
  /** Stable dedupe key across arms (e.g. graph node id, memory id). */
  sourceId: string
  metadata?: string
}

export interface LexicalCandidate {
  id: string
  sourceKind: RetrievalSourceKind
  kind: string
  title: string | null
  uri: string | null
  snippet: string
  sourceId: string
  /** Optional FTS bm25/rank (lower is better for SQLite FTS5 rank). */
  ftsRank?: number
  metadata?: string
}

export interface RetrieveResult {
  hits: RankedHit[]
  mode: 'hybrid' | 'lexical'
  suggestions: string[]
  normalized: NormalizedQuery
}

export interface EmbedClient {
  embed(text: string, timeoutMs?: number): Promise<Float32Array | null>
  available(): boolean
}

export interface VectorHit {
  id: string
  sourceKind: RetrievalSourceKind
  kind: string
  title: string | null
  uri: string | null
  snippet: string
  sourceId: string
  score: number
  metadata?: string
}

export interface RetrieveDeps {
  searchLexical: (
    normalized: NormalizedQuery,
    limit: number,
  ) => LexicalCandidate[] | Promise<LexicalCandidate[]>
  searchVectors?: (
    queryVec: Float32Array,
    limit: number,
  ) => VectorHit[] | Promise<VectorHit[]>
  searchPaths?: (
    tokens: string[],
    limit: number,
  ) => LexicalCandidate[] | Promise<LexicalCandidate[]>
  embedClient?: EmbedClient
}
