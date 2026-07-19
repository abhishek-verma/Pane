/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { rankLexical, tokenCoverage, toOrFtsMatchQuery } from './fts'

describe('toOrFtsMatchQuery', () => {
  it('joins tokens with OR', () => {
    expect(toOrFtsMatchQuery(['upcoming', 'interviews'])).toBe(
      '"upcoming"* OR "interviews"*',
    )
  })

  it('returns null for empty', () => {
    expect(toOrFtsMatchQuery([])).toBeNull()
  })
})

describe('rankLexical', () => {
  it('prefers higher coverage hits', () => {
    const ranked = rankLexical(
      [
        {
          id: '1',
          sourceId: '1',
          sourceKind: 'graph',
          kind: 'file',
          title: 'Collider',
          uri: 'https://collider.com',
          snippet: 'movie interviews',
        },
        {
          id: '2',
          sourceId: '2',
          sourceKind: 'graph',
          kind: 'file',
          title: 'Pipeline-Status.md',
          uri: 'Interviews/Pipeline-Status.md',
          snippet: '## Upcoming interviews Metafore',
        },
      ],
      ['upcoming', 'interviews'],
    )
    expect(ranked[0]?.sourceId).toBe('2')
    expect(
      tokenCoverage(
        ['upcoming', 'interviews'],
        ranked[0]?.title ?? null,
        ranked[0]?.snippet ?? '',
        ranked[0]?.uri ?? null,
      ),
    ).toBeGreaterThan(0.5)
  })
})
