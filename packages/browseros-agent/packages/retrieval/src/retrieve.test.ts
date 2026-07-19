/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { hashEmbed } from './hash-embed'
import { retrieve } from './retrieve'
import type { LexicalCandidate, VectorHit } from './types'
import { cosineSimilarity } from './vector'

describe('retrieve hybrid', () => {
  const pipeline: LexicalCandidate = {
    id: 'node_pipeline',
    sourceId: 'node_pipeline',
    sourceKind: 'graph',
    kind: 'file',
    title: 'Pipeline-Status.md',
    uri: 'Interviews/Pipeline-Status.md',
    snippet:
      '# Interview Pipeline — Jul 2026\n## Upcoming\n### Metafore.ai — Director of Engineering',
  }

  it('returns pipeline via lexical OR for NL interview query', async () => {
    const result = await retrieve(
      'what interviews are coming up?',
      {
        searchLexical: (n) => {
          // Simulate FTS OR returning both a weak and strong hit
          const hay =
            `${pipeline.title} ${pipeline.snippet} ${pipeline.uri}`.toLowerCase()
          if (n.tokens.some((t) => hay.includes(t))) return [pipeline]
          return []
        },
      },
      { lexicalOnly: true },
    )
    expect(result.hits.some((h) => h.title === 'Pipeline-Status.md')).toBe(true)
    expect(result.mode).toBe('lexical')
  })

  it('merges semantic arm when vectors available', async () => {
    const docVec = hashEmbed(pipeline.snippet)
    const result = await retrieve('upcoming interview schedule', {
      searchLexical: () => [],
      embedClient: {
        available: () => true,
        embed: async () => hashEmbed('upcoming interview schedule'),
      },
      searchVectors: (q): VectorHit[] => {
        const score = cosineSimilarity(q, docVec)
        if (score < 0.1) return []
        return [
          {
            id: pipeline.id,
            sourceId: pipeline.sourceId,
            sourceKind: 'embedding',
            kind: 'file',
            title: pipeline.title,
            uri: pipeline.uri,
            snippet: pipeline.snippet,
            score,
          },
        ]
      },
    })
    expect(result.mode).toBe('hybrid')
    expect(result.hits[0]?.title).toBe('Pipeline-Status.md')
  })

  it('returns suggestions on empty', async () => {
    const result = await retrieve('zzzznonexistent', {
      searchLexical: () => [],
    })
    expect(result.hits).toEqual([])
    expect(result.suggestions.length).toBeGreaterThan(0)
  })
})
