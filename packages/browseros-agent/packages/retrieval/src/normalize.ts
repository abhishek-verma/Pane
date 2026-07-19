/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { STOPWORDS } from './constants'
import type { NormalizedQuery, RetrievalHint } from './types'

function stripFtsNoise(token: string): string {
  return token.replace(/["'*(){}[\]^~:]+/g, '')
}

/** Tokenize free text into lowercased alphanumeric-ish terms. */
export function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .trim()
    .split(/[^a-z0-9_+./-]+/)
    .map(stripFtsNoise)
    .filter((t) => t.length > 0)
}

/** Content tokens with stopwords removed (keeps temporal cues like "upcoming"). */
export function contentTokens(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tokenize(raw)) {
    if (STOPWORDS.has(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function detectHints(raw: string, tokens: string[]): RetrievalHint[] {
  const hints: RetrievalHint[] = []
  const lower = raw.toLowerCase()
  if (
    tokens.some((t) =>
      ['upcoming', 'soon', 'tomorrow', 'today', 'next', 'schedule'].includes(t),
    ) ||
    /\b(coming up|this week|next week)\b/.test(lower)
  ) {
    hints.push('temporal')
  }
  if (
    /\b(remember|prefer|preference|my name|i am|i'm)\b/.test(lower) ||
    tokens.includes('preference')
  ) {
    hints.push('memory_fact')
  }
  if (
    /\b(discuss(ed)?|talked|chat|conversation|last time|earlier)\b/.test(lower)
  ) {
    hints.push('past_chat')
  }
  if (
    /\b(file|folder|path|readme|vault|doc|markdown)\b/.test(lower) ||
    tokens.some((t) => t.includes('.'))
  ) {
    hints.push('file_name')
  }
  return hints
}

/** Normalize a natural-language query for hybrid retrieval. */
export function normalizeQuery(raw: string): NormalizedQuery {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  const tokens = contentTokens(trimmed)
  const embedText = trimmed.toLowerCase()
  return {
    raw: trimmed,
    tokens,
    embedText,
    hints: detectHints(trimmed, tokens),
  }
}
