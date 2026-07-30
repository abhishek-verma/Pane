/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  boardNodeSchema,
  pageDocSchema,
  patchOpSchema,
} from '../../src/personal-internet/pi-node-schema'

describe('pi-node-schema', () => {
  it('accepts correct board shape', () => {
    const parsed = boardNodeSchema.parse({
      type: 'board',
      columns: [{ id: 'todo', title: 'To Do', cardIds: ['c1'] }],
      cards: [{ id: 'c1', title: 'Register domain', subtitle: 'pane.ai' }],
    })
    expect(parsed.cards[0].id).toBe('c1')
  })

  it('rejects card.columnId / description (strict cards)', () => {
    const result = boardNodeSchema.safeParse({
      type: 'board',
      columns: [{ id: 'todo', title: 'To Do', cardIds: [] }],
      cards: [
        {
          columnId: 'todo',
          title: 'Register domain',
          description: 'pane.ai',
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects boards missing cardIds on columns', () => {
    const result = boardNodeSchema.safeParse({
      type: 'board',
      columns: [{ id: 'todo', title: 'To Do' }],
      cards: [],
    })
    expect(result.success).toBe(false)
  })

  it('pageDocSchema accepts a small valid doc', () => {
    const doc = pageDocSchema.parse({
      version: 1,
      title: 'Demo',
      nodes: [
        { type: 'title', text: 'Demo' },
        {
          type: 'board',
          columns: [{ id: 'todo', title: 'To Do', cardIds: [] }],
          cards: [],
        },
      ],
    })
    expect(doc.nodes).toHaveLength(2)
  })

  it('patchOpSchema accepts upsertBoardCard with columnId on the op', () => {
    const op = patchOpSchema.parse({
      op: 'upsertBoardCard',
      card: {
        id: 'c1',
        title: 'Register domain',
        columnId: 'todo',
        subtitle: 'pane.ai',
      },
    })
    expect(op.op).toBe('upsertBoardCard')
  })
})
