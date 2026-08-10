/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { applySelectionClick } from './context-selection.helpers'

describe('applySelectionClick', () => {
  it('toggles a single id on plain click', () => {
    const r1 = applySelectionClick({
      selected: new Set(),
      lastClickedId: null,
      clickedId: 'b',
      visibleIds: ['a', 'b', 'c'],
      shiftKey: false,
    })
    expect([...r1.selected]).toEqual(['b'])
    expect(r1.lastClickedId).toBe('b')

    const r2 = applySelectionClick({
      selected: r1.selected,
      lastClickedId: r1.lastClickedId,
      clickedId: 'b',
      visibleIds: ['a', 'b', 'c'],
      shiftKey: false,
    })
    expect([...r2.selected]).toEqual([])
  })

  it('selects a forward range on shift+click', () => {
    const r = applySelectionClick({
      selected: new Set(['a']),
      lastClickedId: 'a',
      clickedId: 'd',
      visibleIds: ['a', 'b', 'c', 'd', 'e'],
      shiftKey: true,
    })
    expect([...r.selected].sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(r.lastClickedId).toBe('d')
  })

  it('selects a backward range on shift+click', () => {
    const r = applySelectionClick({
      selected: new Set(['d']),
      lastClickedId: 'd',
      clickedId: 'a',
      visibleIds: ['a', 'b', 'c', 'd', 'e'],
      shiftKey: true,
    })
    expect([...r.selected].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('falls back to a plain toggle when shift+click has no anchor in this list', () => {
    const r = applySelectionClick({
      selected: new Set(),
      lastClickedId: 'not-in-this-list',
      clickedId: 'b',
      visibleIds: ['a', 'b', 'c'],
      shiftKey: true,
    })
    expect([...r.selected]).toEqual(['b'])
  })

  it('union-adds a range onto an existing unrelated selection', () => {
    const r = applySelectionClick({
      selected: new Set(['z']),
      lastClickedId: 'a',
      clickedId: 'c',
      visibleIds: ['a', 'b', 'c'],
      shiftKey: true,
    })
    expect([...r.selected].sort()).toEqual(['a', 'b', 'c', 'z'])
  })
})
