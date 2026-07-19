/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { COVERAGE_SOFT_MIN } from './constants'
import type { LexicalCandidate } from './types'

/** Build a safe FTS5 MATCH query using OR of prefix tokens. */
export function toOrFtsMatchQuery(tokens: string[]): string | null {
  const cleaned = tokens
    .map((t) => t.replace(/["'*(){}[\]^~:]+/g, ''))
    .filter((t) => t.length > 0)
  if (cleaned.length === 0) return null
  return cleaned.map((t) => `"${t}"*`).join(' OR ')
}

/** Fraction of query tokens that appear in title/snippet/uri. */
export function tokenCoverage(
  tokens: string[],
  title: string | null,
  snippet: string,
  uri: string | null,
): number {
  if (tokens.length === 0) return 0
  const hay = `${title ?? ''} ${snippet} ${uri ?? ''}`.toLowerCase()
  let matched = 0
  for (const t of tokens) {
    if (hay.includes(t.toLowerCase())) matched++
  }
  return matched / tokens.length
}

export interface ScoredLexical extends LexicalCandidate {
  coverage: number
  lexicalScore: number
}

/**
 * Score lexical candidates: coverage + title boost + inverted FTS rank.
 * Soft-prefers coverage ≥ COVERAGE_SOFT_MIN but falls back to all hits.
 */
export function rankLexical(
  candidates: LexicalCandidate[],
  tokens: string[],
): ScoredLexical[] {
  const scored = candidates.map((c) => {
    const coverage = tokenCoverage(tokens, c.title, c.snippet, c.uri)
    let lexicalScore = coverage * 10
    const title = (c.title ?? '').toLowerCase()
    for (const t of tokens) {
      if (title.includes(t.toLowerCase())) lexicalScore += 2
    }
    if (typeof c.ftsRank === 'number') {
      // SQLite FTS5 rank is typically negative; higher (closer to 0) is better.
      lexicalScore += 1 / (1 + Math.abs(c.ftsRank))
    }
    return { ...c, coverage, lexicalScore }
  })

  scored.sort((a, b) => b.lexicalScore - a.lexicalScore)

  const preferred = scored.filter((s) => s.coverage >= COVERAGE_SOFT_MIN)
  return preferred.length > 0 ? preferred : scored
}

/** Pick the rarest (longest) tokens as a backoff query. */
export function rarestTokens(tokens: string[], n = 2): string[] {
  return [...tokens].sort((a, b) => b.length - a.length).slice(0, n)
}
