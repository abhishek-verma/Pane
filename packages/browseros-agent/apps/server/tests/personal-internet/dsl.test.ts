/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  applyPatchOps,
  PiDslError,
  validatePageDoc,
} from '../../src/personal-internet/dsl'
import type { PiPageDoc } from '../../src/personal-internet/types'

const baseDoc: PiPageDoc = {
  version: 1,
  title: 'Test',
  nodes: [
    { type: 'title', text: 'Test' },
    {
      type: 'table',
      columns: [
        { id: 'name', header: 'Name' },
        { id: 'stage', header: 'Stage' },
      ],
      rows: [],
    },
  ],
}

describe('pi dsl', () => {
  it('validates a page doc', () => {
    const doc = validatePageDoc(baseDoc)
    expect(doc.title).toBe('Test')
  })

  it('rejects script injection', () => {
    expect(() =>
      validatePageDoc({
        version: 1,
        title: 'x',
        nodes: [{ type: 'text', text: '<script>alert(1)</script>' }],
      }),
    ).toThrow(PiDslError)
  })

  it('setTitle and upsertTableRow', () => {
    const next = applyPatchOps(baseDoc, [
      { op: 'setTitle', title: 'Pipeline' },
      {
        op: 'upsertTableRow',
        row: {
          id: 'r1',
          recordId: 'rec1',
          cells: { name: 'Acme', stage: 'applied' },
        },
      },
    ])
    expect(next.title).toBe('Pipeline')
    const table = next.nodes.find((n) => n.type === 'table')
    expect(table?.type).toBe('table')
    if (table?.type === 'table') {
      expect(table.rows).toHaveLength(1)
      expect(table.rows[0].cells.name).toBe('Acme')
    }
  })

  it('board upsert and move', () => {
    const boardDoc: PiPageDoc = {
      version: 1,
      title: 'Board',
      nodes: [
        {
          type: 'board',
          columns: [
            { id: 'applied', title: 'Applied', cardIds: [] },
            { id: 'interviewing', title: 'Interviewing', cardIds: [] },
          ],
          cards: [],
        },
      ],
    }
    const next = applyPatchOps(boardDoc, [
      {
        op: 'upsertBoardCard',
        card: {
          id: 'c1',
          title: 'Acme',
          columnId: 'applied',
          recordId: 'rec1',
        },
      },
      { op: 'moveBoardCard', cardId: 'c1', toColumnId: 'interviewing' },
    ])
    const board = next.nodes[0]
    expect(board.type).toBe('board')
    if (board.type === 'board') {
      expect(board.cards).toHaveLength(1)
      expect(board.columns[0].cardIds).toEqual([])
      expect(board.columns[1].cardIds).toEqual(['c1'])
    }
  })

  it('accepts labeled and bare board card actions', () => {
    const labeled = validatePageDoc({
      version: 1,
      title: 'Board',
      nodes: [
        {
          type: 'board',
          columns: [{ id: 'applied', title: 'Applied', cardIds: ['c1'] }],
          cards: [
            {
              id: 'c1',
              title: 'Acme',
              actions: [
                {
                  label: 'Details',
                  action: {
                    kind: 'open-internal',
                    route: '#/pi/sites/s1/entities/acme',
                  },
                },
              ],
            },
          ],
        },
      ],
    })
    const board = labeled.nodes[0]
    expect(board.type).toBe('board')
    if (board.type === 'board') {
      expect(board.cards[0].actions?.[0]).toEqual({
        label: 'Details',
        action: {
          kind: 'open-internal',
          route: '#/pi/sites/s1/entities/acme',
        },
      })
    }

    const bare = validatePageDoc({
      version: 1,
      title: 'Board',
      nodes: [
        {
          type: 'board',
          columns: [{ id: 'applied', title: 'Applied', cardIds: ['c1'] }],
          cards: [
            {
              id: 'c1',
              title: 'Acme',
              actions: [{ kind: 'open-external', url: 'https://example.com' }],
            },
          ],
        },
      ],
    })
    const board2 = bare.nodes[0]
    expect(board2.type).toBe('board')
    if (board2.type === 'board') {
      expect(board2.cards[0].actions?.[0]).toEqual({
        label: 'Open link',
        action: { kind: 'open-external', url: 'https://example.com' },
      })
    }
  })

  it('setMaterializeSection advances phase atf → structure → filling', () => {
    const atf: PiPageDoc = {
      version: 1,
      title: 'Co',
      nodes: [{ type: 'title', text: 'Co' }],
      meta: {
        entityKey: 'co',
        materialize: { phase: 'atf', sections: [] },
      },
    }
    const structured = applyPatchOps(atf, [
      {
        op: 'setMaterializeSection',
        id: 'overview',
        title: 'Overview',
        status: 'shell',
      },
    ])
    expect(structured.meta?.materialize?.phase).toBe('btf-structure')

    const filling = applyPatchOps(structured, [
      {
        op: 'setMaterializeSection',
        id: 'overview',
        status: 'filled',
      },
    ])
    expect(filling.meta?.materialize?.phase).toBe('btf-filling')
    expect(filling.meta?.materialize?.sections[0]?.status).toBe('filled')
  })

  it('accepts chart and mermaid; sanitizes svg; rejects hostile svg', () => {
    const doc = validatePageDoc({
      version: 1,
      title: 'Viz',
      nodes: [
        {
          type: 'chart',
          chartType: 'bar',
          title: 'Stages',
          data: [
            { label: 'A', value: 2 },
            { label: 'B', value: 5 },
          ],
        },
        {
          type: 'mermaid',
          title: 'Flow',
          source: 'flowchart LR\n  A --> B',
        },
        {
          type: 'svg',
          title: 'Dot',
          markup:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/></svg>',
        },
      ],
    })
    expect(doc.nodes).toHaveLength(3)

    expect(() =>
      validatePageDoc({
        version: 1,
        title: 'Bad',
        nodes: [
          {
            type: 'svg',
            markup:
              '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
          },
        ],
      }),
    ).toThrow(PiDslError)
  })
})
