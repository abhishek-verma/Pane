/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { PiNode } from './types'

type BoardNode = Extract<PiNode, { type: 'board' }>

function slugCardId(title: string, index: number): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'card'
  return `card_${base}_${index}`
}

/** Client-side coerce for boards agents wrote as `{ columnId, description }`. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: mirrors server normalizeBoardNode
export function normalizeBoardForRender(node: BoardNode): BoardNode {
  const columns = Array.isArray(node.columns) ? node.columns : []
  const rawCards = Array.isArray(node.cards) ? node.cards : []

  const nextColumns = columns.map((col) => ({
    ...col,
    id: typeof col.id === 'string' ? col.id : 'col',
    title: typeof col.title === 'string' ? col.title : 'Column',
    cardIds: Array.isArray(col.cardIds) ? [...col.cardIds] : [],
  }))
  const colById = new Map(nextColumns.map((c) => [c.id, c]))
  const usedIds = new Set<string>()
  const cards: BoardNode['cards'] = []

  for (let i = 0; i < rawCards.length; i++) {
    const raw = rawCards[i] as BoardNode['cards'][number] & {
      columnId?: unknown
      description?: unknown
    }
    const title =
      typeof raw.title === 'string' && raw.title.trim()
        ? raw.title.trim()
        : `Card ${i + 1}`
    let id =
      typeof raw.id === 'string' && raw.id.trim()
        ? raw.id.trim()
        : slugCardId(title, i)
    if (usedIds.has(id)) id = `${id}_${i}`
    usedIds.add(id)

    const subtitle =
      typeof raw.subtitle === 'string' && raw.subtitle.trim()
        ? raw.subtitle.trim()
        : typeof raw.description === 'string' && raw.description.trim()
          ? raw.description.trim()
          : undefined

    cards.push({
      id,
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(typeof raw.recordId === 'string' ? { recordId: raw.recordId } : {}),
      ...(typeof raw.entityKey === 'string'
        ? { entityKey: raw.entityKey }
        : {}),
      ...(Array.isArray(raw.actions) ? { actions: raw.actions } : {}),
    })

    const columnId = typeof raw.columnId === 'string' ? raw.columnId.trim() : ''
    if (columnId && colById.has(columnId)) {
      const col = colById.get(columnId)
      if (col && !col.cardIds.includes(id)) col.cardIds.push(id)
    }
  }

  const known = new Set(cards.map((c) => c.id))
  for (const col of nextColumns) {
    col.cardIds = [...new Set(col.cardIds.filter((id) => known.has(id)))]
  }
  const placed = new Set(nextColumns.flatMap((c) => c.cardIds))
  const first = nextColumns[0]
  if (first) {
    for (const card of cards) {
      if (!placed.has(card.id)) {
        first.cardIds.push(card.id)
        placed.add(card.id)
      }
    }
  }

  return { type: 'board', columns: nextColumns, cards }
}
