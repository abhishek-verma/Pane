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

  it('accepts a stat node with label/value/tone', () => {
    const doc = pageDocSchema.parse({
      version: 1,
      title: 'Demo',
      nodes: [
        {
          type: 'stat',
          label: 'Active applications',
          value: '12',
          tone: 'good',
        },
      ],
    })
    expect(doc.nodes[0]).toEqual({
      type: 'stat',
      label: 'Active applications',
      value: '12',
      tone: 'good',
    })
  })

  it('accepts a stack node with a 2-4 column grid', () => {
    const doc = pageDocSchema.parse({
      version: 1,
      title: 'Demo',
      nodes: [
        {
          type: 'stack',
          columns: 2,
          children: [
            { type: 'text', text: 'Left' },
            { type: 'text', text: 'Right' },
          ],
        },
      ],
    })
    expect(doc.nodes[0]).toMatchObject({ type: 'stack', columns: 2 })
  })

  it('rejects a stack columns value outside 2-4', () => {
    const result = pageDocSchema.safeParse({
      version: 1,
      title: 'Demo',
      nodes: [
        { type: 'stack', columns: 5, children: [{ type: 'text', text: 'x' }] },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a stat node with an empty label or value', () => {
    const missingLabel = pageDocSchema.safeParse({
      version: 1,
      title: 'Demo',
      nodes: [{ type: 'stat', label: '', value: '12' }],
    })
    expect(missingLabel.success).toBe(false)

    const missingValue = pageDocSchema.safeParse({
      version: 1,
      title: 'Demo',
      nodes: [{ type: 'stat', label: 'Active', value: '' }],
    })
    expect(missingValue.success).toBe(false)
  })
})
