/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { toOrFtsMatchQuery } from '@browseros/retrieval/fts'
import { type RetrieveOptions, retrieve } from '@browseros/retrieval/retrieve'
import type {
  LexicalCandidate,
  RetrieveResult,
} from '@browseros/retrieval/types'
import { lookupResearchCitation } from '../capture/research-citations'
import { getDeniedHosts } from '../context/grants'
import { graphSearch } from '../context/repo'
import { getDbHandle } from '../lib/db'
import { searchChatFts } from './chat-fts'
import { chunkCount, searchChunks } from './chunks'
import { createEmbedClient } from './embed-client'
import { searchMemoryFts } from './memory-fts'

export interface HybridSearchOptions extends RetrieveOptions {
  bucketId?: string
  workspaceRoot?: string | null
}

function graphLexical(
  bucketId: string,
  tokens: string[],
  limit: number,
  denied: Set<string>,
): LexicalCandidate[] {
  const q = tokens.join(' ')
  if (!q) return []
  // graphSearch uses toFtsMatchQuery (OR) on the raw string
  const hits = graphSearch(bucketId, q, limit, { deniedHosts: denied })
  return hits.map((h) => {
    const citation =
      h.kind === 'research_page' ? lookupResearchCitation(h.nodeId) : null
    return {
      id: h.nodeId,
      sourceId: h.nodeId,
      sourceKind: 'graph' as const,
      kind: h.kind,
      title: h.title,
      uri: h.uri,
      snippet: h.snippet,
      metadata: citation
        ? JSON.stringify({
            url: citation.url,
            quote: citation.quote,
            capturedAt: citation.capturedAt,
          })
        : undefined,
    }
  })
}

function memoryLexical(
  bucketId: string,
  tokens: string[],
  limit: number,
): LexicalCandidate[] {
  return searchMemoryFts(bucketId, tokens, limit).map((h) => ({
    id: h.id,
    sourceId: h.id,
    sourceKind: 'memory' as const,
    kind: 'memory',
    title: `Memory: ${h.layer}`,
    uri: null,
    snippet: h.content.slice(0, 500),
  }))
}

function chatLexical(
  bucketId: string,
  tokens: string[],
  limit: number,
): LexicalCandidate[] {
  return searchChatFts(bucketId, tokens, limit).map((h) => ({
    id: h.id,
    sourceId: h.id,
    sourceKind: 'chat' as const,
    kind: 'chat',
    title: `${h.role} message`,
    uri: `chat:${h.sessionId}`,
    snippet: h.content.slice(0, 500),
  }))
}

function pathLexical(
  workspaceRoot: string,
  tokens: string[],
  limit: number,
): LexicalCandidate[] {
  const match = toOrFtsMatchQuery(tokens)
  if (!match) return []
  // Search indexed file nodes by uri/title containing tokens (casefold).
  const rows = getDbHandle()
    .sqlite.prepare(
      `SELECT id, kind, title, uri, summary
       FROM graph_nodes
       WHERE kind = 'file'
       LIMIT 500`,
    )
    .all() as Array<{
    id: string
    kind: string
    title: string | null
    uri: string | null
    summary: string | null
  }>

  const lowerTokens = tokens.map((t) => t.toLowerCase())
  const hits: LexicalCandidate[] = []
  for (const r of rows) {
    const hay = `${r.title ?? ''} ${r.uri ?? ''}`.toLowerCase()
    if (!lowerTokens.some((t) => hay.includes(t))) continue
    hits.push({
      id: r.id,
      sourceId: r.id,
      sourceKind: 'file_path',
      kind: 'file',
      title: r.title,
      uri: r.uri,
      snippet: (r.summary ?? r.uri ?? '').slice(0, 500),
    })
    if (hits.length >= limit) break
  }
  void workspaceRoot
  return hits
}

/** Hybrid NL search over graph, memory, chat, paths, and embeddings. */
export async function hybridSearch(
  query: string,
  options: HybridSearchOptions = {},
): Promise<RetrieveResult> {
  const bucketId = options.bucketId || DEFAULT_BUCKET_ID
  const denied = new Set(getDeniedHosts(bucketId))
  const hasVectors = chunkCount(bucketId) > 0

  return retrieve(
    query,
    {
      searchLexical: (normalized, limit) => {
        const tokens = normalized.tokens
        if (tokens.length === 0) return []
        const per = Math.max(4, Math.ceil(limit / 2))
        return [
          ...graphLexical(bucketId, tokens, per, denied),
          ...memoryLexical(bucketId, tokens, per),
          ...chatLexical(bucketId, tokens, per),
        ]
      },
      searchPaths: options.workspaceRoot
        ? (tokens, limit) =>
            pathLexical(options.workspaceRoot as string, tokens, limit)
        : undefined,
      embedClient: options.lexicalOnly ? undefined : createEmbedClient(),
      searchVectors: hasVectors
        ? (vec, limit) => searchChunks(bucketId, vec, limit)
        : undefined,
    },
    {
      limit: options.limit,
      lexicalOnly: options.lexicalOnly,
      embedTimeoutMs: options.embedTimeoutMs,
    },
  )
}

export function formatRetrieveResult(result: RetrieveResult): string {
  if (result.hits.length === 0) {
    const tips = result.suggestions.map((s) => `- ${s}`).join('\n')
    return `No context matches for "${result.normalized.raw}".\nSuggestions:\n${tips}`
  }
  const mode = result.mode === 'hybrid' ? 'hybrid' : 'lexical'
  const lines = result.hits.map((c, i) => {
    const citationLine = c.metadata ? `\n   citation: ${c.metadata}` : ''
    return `${i + 1}. [${c.kind}/${c.sourceKind}] ${c.title ?? '(untitled)'}${c.uri ? ` — ${c.uri}` : ''}\n   ${c.snippet}${citationLine}`
  })
  return `(${mode}) ${lines.join('\n')}`
}
