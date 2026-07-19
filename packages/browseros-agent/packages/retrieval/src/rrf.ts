/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { RRF_K } from './constants'
import type { RankedHit } from './types'

export interface RrfListItem {
  sourceId: string
  hit: Omit<RankedHit, 'score'>
}

/** Reciprocal Rank Fusion over multiple ranked lists. */
export function mergeRrf(
  lists: RrfListItem[][],
  limit: number,
  k = RRF_K,
): RankedHit[] {
  const scores = new Map<
    string,
    { score: number; hit: Omit<RankedHit, 'score'> }
  >()

  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      if (!item) continue
      const contrib = 1 / (k + i + 1)
      const existing = scores.get(item.sourceId)
      if (existing) {
        existing.score += contrib
      } else {
        scores.set(item.sourceId, { score: contrib, hit: item.hit })
      }
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, hit }) => ({ ...hit, score }))
}
