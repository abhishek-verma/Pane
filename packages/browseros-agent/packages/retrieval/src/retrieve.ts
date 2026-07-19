/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  EMBED_QUERY_TIMEOUT_MS,
  RETRIEVE_DEFAULT_LIMIT,
  RETRIEVE_MAX_LIMIT,
} from './constants'
import { rankLexical, rarestTokens, toOrFtsMatchQuery } from './fts'
import { normalizeQuery } from './normalize'
import { mergeRrf, type RrfListItem } from './rrf'
import type {
  LexicalCandidate,
  RankedHit,
  RetrieveDeps,
  RetrieveResult,
} from './types'

function toRrfList(hits: RankedHit[]): RrfListItem[] {
  return hits.map((h) => ({
    sourceId: h.sourceId,
    hit: {
      id: h.id,
      sourceKind: h.sourceKind,
      kind: h.kind,
      title: h.title,
      uri: h.uri,
      snippet: h.snippet,
      sourceId: h.sourceId,
      metadata: h.metadata,
    },
  }))
}

function lexicalToRanked(candidates: LexicalCandidate[]): RankedHit[] {
  return candidates.map((c, i) => ({
    id: c.id,
    sourceKind: c.sourceKind,
    kind: c.kind,
    title: c.title,
    uri: c.uri,
    snippet: c.snippet,
    sourceId: c.sourceId,
    metadata: c.metadata,
    score: 1 / (i + 1),
  }))
}

const DEFAULT_SUGGESTIONS = [
  'try filesystem_ls .',
  'try capture_list for recent meetings',
  'try session_search for past chats',
  'try context_current_work',
]

export interface RetrieveOptions {
  limit?: number
  /** Force lexical-only (skip embed client). */
  lexicalOnly?: boolean
  embedTimeoutMs?: number
}

/**
 * Hybrid retrieve: normalize → lexical (+ optional vectors) → RRF → ladder.
 */
export async function retrieve(
  query: string,
  deps: RetrieveDeps,
  options: RetrieveOptions = {},
): Promise<RetrieveResult> {
  const limit = Math.min(
    Math.max(1, options.limit ?? RETRIEVE_DEFAULT_LIMIT),
    RETRIEVE_MAX_LIMIT,
  )
  const normalized = normalizeQuery(query)
  if (!normalized.raw) {
    return {
      hits: [],
      mode: 'lexical',
      suggestions: DEFAULT_SUGGESTIONS,
      normalized,
    }
  }

  let mode: 'hybrid' | 'lexical' = 'lexical'
  const lists: RrfListItem[][] = []

  // --- Lexical arm ---
  const lexicalRaw = await deps.searchLexical(normalized, limit * 3)
  const rankedLex = rankLexical(lexicalRaw, normalized.tokens)
  lists.push(toRrfList(lexicalToRanked(rankedLex)))

  // --- Semantic arm ---
  if (
    !options.lexicalOnly &&
    deps.embedClient?.available() &&
    deps.searchVectors
  ) {
    const vec = await deps.embedClient.embed(
      normalized.embedText,
      options.embedTimeoutMs ?? EMBED_QUERY_TIMEOUT_MS,
    )
    if (vec) {
      const vectorHits = await deps.searchVectors(vec, limit * 2)
      if (vectorHits.length > 0) {
        mode = 'hybrid'
        lists.push(
          toRrfList(
            vectorHits.map((v) => ({
              id: v.id,
              sourceKind: v.sourceKind,
              kind: v.kind,
              title: v.title,
              uri: v.uri,
              snippet: v.snippet,
              sourceId: v.sourceId,
              metadata: v.metadata,
              score: v.score,
            })),
          ),
        )
      }
    }
  }

  let hits = mergeRrf(lists, limit)

  // --- Empty-result ladder ---
  if (hits.length === 0 && normalized.tokens.length > 0) {
    const rare = rarestTokens(normalized.tokens, 2)
    if (rare.length > 0 && rare.join(' ') !== normalized.tokens.join(' ')) {
      const backoff = await deps.searchLexical(
        { ...normalized, tokens: rare },
        limit * 2,
      )
      hits = mergeRrf(
        [toRrfList(lexicalToRanked(rankLexical(backoff, rare)))],
        limit,
      )
    }
  }

  if (hits.length === 0 && deps.searchPaths && normalized.tokens.length > 0) {
    const pathHits = await deps.searchPaths(normalized.tokens, limit)
    hits = mergeRrf([toRrfList(lexicalToRanked(pathHits))], limit)
  }

  return {
    hits,
    mode,
    suggestions: hits.length === 0 ? DEFAULT_SUGGESTIONS : [],
    normalized,
  }
}

export { normalizeQuery, toOrFtsMatchQuery }
