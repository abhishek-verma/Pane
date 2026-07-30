/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { normalizeBoardForRender } from './normalizeBoard'
import type { PiNode } from './types'

describe('normalizeBoardForRender', () => {
  it('coerces columnId/description boards into cardIds shape', () => {
    const raw = {
      type: 'board',
      columns: [
        { id: 'todo', title: 'To Do' },
        { id: 'done', title: 'Done' },
      ],
      cards: [
        {
          columnId: 'todo',
          title: 'Register domain',
          description: 'pane.ai',
        },
      ],
    } as unknown as Extract<PiNode, { type: 'board' }>

    const board = normalizeBoardForRender(raw)
    expect(board.columns[0].cardIds).toHaveLength(1)
    expect(board.cards[0].id).toBeTruthy()
    expect(board.cards[0].subtitle).toBe('pane.ai')
    expect(board.columns[0].cardIds[0]).toBe(board.cards[0].id)
  })

  it('does not throw when cardIds are missing', () => {
    const raw = {
      type: 'board',
      columns: [{ id: 'a', title: 'A' }],
      cards: [],
    } as unknown as Extract<PiNode, { type: 'board' }>
    expect(() => normalizeBoardForRender(raw)).not.toThrow()
    expect(normalizeBoardForRender(raw).columns[0].cardIds).toEqual([])
  })
})
