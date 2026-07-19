/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Deterministic bag-of-words hashed embeddings for local/dev/test when an
 * ONNX MiniLM model is not packaged. Same dims as MiniLM-class models.
 */

import { EMBED_DIMS } from './constants'
import { tokenize } from './normalize'
import { l2Normalize } from './vector'

function hashToken(token: string): number {
  let h = 2166136261
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Embed text into a fixed-dim unit vector via feature hashing.
 * Synonym-ish collisions are not guaranteed; lexical arm covers exact terms.
 */
export function hashEmbed(text: string, dims = EMBED_DIMS): Float32Array {
  const vec = new Float32Array(dims)
  const tokens = tokenize(text)
  if (tokens.length === 0) return vec

  for (const token of tokens) {
    const h = hashToken(token)
    const idx = h % dims
    const sign = (h & 1) === 0 ? 1 : -1
    vec[idx] = (vec[idx] ?? 0) + sign
    // Bigram boost for short phrases
    // (handled by iterating consecutive pairs below)
  }

  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]}_${tokens[i + 1]}`
    const h = hashToken(bigram)
    const idx = h % dims
    const sign = (h & 1) === 0 ? 1 : -1
    vec[idx] = (vec[idx] ?? 0) + sign * 1.5
  }

  return l2Normalize(vec)
}
