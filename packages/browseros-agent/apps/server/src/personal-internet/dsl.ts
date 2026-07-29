/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  PI_MAX_CHART_POINTS,
  PI_MAX_MERMAID_CHARS,
  sanitizePiSvg,
} from './sanitize-svg'
import type {
  PiAction,
  PiCardAction,
  PiNode,
  PiPageDoc,
  PiPatchOp,
  TableRow,
} from './types'

/** Normalize `{ label, action }` or bare `PiAction` into a labeled pair. */
export function normalizeCardAction(entry: PiCardAction): {
  label: string
  action: PiAction
} {
  if (
    entry &&
    typeof entry === 'object' &&
    'action' in entry &&
    entry.action &&
    typeof entry.action === 'object' &&
    'kind' in entry.action
  ) {
    const labeled = entry as { label?: unknown; action: PiAction }
    const label =
      typeof labeled.label === 'string' && labeled.label.trim()
        ? labeled.label.trim()
        : defaultActionLabel(labeled.action)
    return { label, action: labeled.action }
  }
  const action = entry as PiAction
  return { label: defaultActionLabel(action), action }
}

function defaultActionLabel(action: PiAction): string {
  switch (action.kind) {
    case 'open-internal':
      return 'Open'
    case 'open-external':
      return 'Open link'
    case 'agent':
      return 'Ask agent'
    case 'local':
      return action.op
    default:
      return 'Action'
  }
}

const MAX_DOC_BYTES = 512 * 1024
const DANGEROUS_RE = /<script|javascript:|on\w+\s*=/i

export class PiDslError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PiDslError'
  }
}

function assertSafeText(value: string, label: string): void {
  if (DANGEROUS_RE.test(value)) {
    throw new PiDslError(`Unsafe content in ${label}`)
  }
}

function validateAction(action: PiAction, path: string): void {
  if (action.kind === 'open-internal') {
    if (!action.route.startsWith('#/')) {
      throw new PiDslError(`${path}: open-internal route must start with #/`)
    }
    assertSafeText(action.route, path)
    return
  }
  if (action.kind === 'open-external') {
    if (!/^https?:\/\//i.test(action.url)) {
      throw new PiDslError(`${path}: open-external url must be http(s)`)
    }
    assertSafeText(action.url, path)
    return
  }
  if (action.kind === 'local') {
    if (!['filter', 'expand', 'copy', 'dismiss'].includes(action.op)) {
      throw new PiDslError(`${path}: invalid local op`)
    }
    return
  }
  if (action.kind === 'agent') {
    if (!action.query.trim()) {
      throw new PiDslError(`${path}: agent query required`)
    }
    assertSafeText(action.query, `${path}.query`)
    return
  }
  throw new PiDslError(`${path}: unknown action kind`)
}

function validateNode(node: PiNode, path: string): void {
  switch (node.type) {
    case 'title':
    case 'text':
    case 'note':
      assertSafeText(node.text, path)
      return
    case 'badge':
      assertSafeText(node.text, path)
      return
    case 'divider':
      return
    case 'stack':
      if (!Array.isArray(node.children)) {
        throw new PiDslError(`${path}: stack children required`)
      }
      for (const [i, child] of node.children.entries()) {
        validateNode(child, `${path}.children[${i}]`)
      }
      return
    case 'button':
      assertSafeText(node.label, path)
      validateAction(node.action, `${path}.action`)
      if (node.replaceWith)
        validateNode(node.replaceWith, `${path}.replaceWith`)
      return
    case 'link':
      assertSafeText(node.label, path)
      validateAction(node.action, `${path}.action`)
      return
    case 'table':
      for (const col of node.columns) {
        assertSafeText(col.id, path)
        assertSafeText(col.header, path)
      }
      for (const row of node.rows) {
        assertSafeText(row.id, path)
        for (const [k, v] of Object.entries(row.cells)) {
          assertSafeText(k, path)
          if (typeof v === 'string') assertSafeText(v, path)
          else validateNode(v, `${path}.cells.${k}`)
        }
      }
      return
    case 'board':
      for (const col of node.columns) {
        assertSafeText(col.id, path)
        assertSafeText(col.title, path)
      }
      for (const card of node.cards) {
        assertSafeText(card.id, path)
        assertSafeText(card.title, path)
        if (card.subtitle) assertSafeText(card.subtitle, path)
        if (card.actions) {
          for (const [i, entry] of card.actions.entries()) {
            const { label, action } = normalizeCardAction(entry)
            assertSafeText(
              label,
              `${path}.card[${card.id}].actions[${i}].label`,
            )
            validateAction(action, `${path}.card[${card.id}].actions[${i}]`)
            // Persist normalized shape so renderer and later patches share one form.
            ;(card.actions as Array<{ label: string; action: PiAction }>)[i] = {
              label,
              action,
            }
          }
        }
      }
      return
    case 'chart': {
      const allowed = ['bar', 'line', 'pie', 'horizontal-bar'] as const
      if (!allowed.includes(node.chartType)) {
        throw new PiDslError(`${path}: invalid chartType`)
      }
      if (node.title) assertSafeText(node.title, path)
      if (node.unit) assertSafeText(node.unit, path)
      if (!Array.isArray(node.data) || node.data.length === 0) {
        throw new PiDslError(`${path}: chart data required`)
      }
      if (node.data.length > PI_MAX_CHART_POINTS) {
        throw new PiDslError(
          `${path}: chart data exceeds ${PI_MAX_CHART_POINTS} points`,
        )
      }
      for (const [i, point] of node.data.entries()) {
        if (!point || typeof point.label !== 'string') {
          throw new PiDslError(`${path}.data[${i}]: label required`)
        }
        assertSafeText(point.label, `${path}.data[${i}]`)
        if (typeof point.value !== 'number' || !Number.isFinite(point.value)) {
          throw new PiDslError(
            `${path}.data[${i}]: value must be finite number`,
          )
        }
      }
      return
    }
    case 'mermaid': {
      if (typeof node.source !== 'string' || !node.source.trim()) {
        throw new PiDslError(`${path}: mermaid source required`)
      }
      if (node.source.length > PI_MAX_MERMAID_CHARS) {
        throw new PiDslError(
          `${path}: mermaid exceeds ${PI_MAX_MERMAID_CHARS} chars`,
        )
      }
      assertSafeText(node.source, path)
      if (node.title) assertSafeText(node.title, path)
      // Block HTML/script smuggling inside mermaid text
      if (/<svg|<script|javascript:/i.test(node.source)) {
        throw new PiDslError(`${path}: unsafe mermaid source`)
      }
      return
    }
    case 'svg': {
      if (node.title) assertSafeText(node.title, path)
      if (node.alt) assertSafeText(node.alt, path)
      try {
        // Mutate cleaned markup onto the node so persisted docs are sanitized.
        ;(node as { markup: string }).markup = sanitizePiSvg(node.markup, path)
      } catch (e) {
        throw new PiDslError(e instanceof Error ? e.message : String(e))
      }
      return
    }
    default:
      throw new PiDslError(`${path}: unknown node type`)
  }
}

export function validatePageDoc(input: unknown): PiPageDoc {
  if (!input || typeof input !== 'object') {
    throw new PiDslError('Page doc must be an object')
  }
  const raw = input as Record<string, unknown>
  if (raw.version !== 1) {
    throw new PiDslError('Page doc version must be 1')
  }
  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    throw new PiDslError('Page doc title required')
  }
  assertSafeText(raw.title, 'title')
  if (!Array.isArray(raw.nodes)) {
    throw new PiDslError('Page doc nodes must be an array')
  }
  const doc: PiPageDoc = {
    version: 1,
    title: raw.title,
    nodes: raw.nodes as PiNode[],
  }
  const bytes = Buffer.byteLength(JSON.stringify(doc), 'utf8')
  if (bytes > MAX_DOC_BYTES) {
    throw new PiDslError(`Page doc exceeds ${MAX_DOC_BYTES} bytes`)
  }
  for (const [i, node] of doc.nodes.entries()) {
    validateNode(node, `nodes[${i}]`)
  }
  return doc
}

function findFirstTable(
  nodes: PiNode[],
): Extract<PiNode, { type: 'table' }> | null {
  for (const n of nodes) {
    if (n.type === 'table') return n
    if (n.type === 'stack') {
      const inner = findFirstTable(n.children)
      if (inner) return inner
    }
  }
  return null
}

function findFirstBoard(
  nodes: PiNode[],
): Extract<PiNode, { type: 'board' }> | null {
  for (const n of nodes) {
    if (n.type === 'board') return n
    if (n.type === 'stack') {
      const inner = findFirstBoard(n.children)
      if (inner) return inner
    }
  }
  return null
}

export function applyPatchOps(doc: PiPageDoc, ops: PiPatchOp[]): PiPageDoc {
  let next: PiPageDoc = {
    version: 1,
    title: doc.title,
    nodes: structuredClone(doc.nodes),
  }

  for (const op of ops) {
    switch (op.op) {
      case 'setTitle':
        assertSafeText(op.title, 'setTitle')
        next = { ...next, title: op.title }
        break
      case 'replaceNodes':
        for (const [i, node] of op.nodes.entries()) {
          validateNode(node, `replaceNodes[${i}]`)
        }
        next = { ...next, nodes: structuredClone(op.nodes) }
        break
      case 'upsertTableRow': {
        const table = findFirstTable(next.nodes)
        if (!table) throw new PiDslError('upsertTableRow: no table in page')
        validateNode(
          { type: 'table', columns: table.columns, rows: [op.row as TableRow] },
          'upsertTableRow',
        )
        const idx = table.rows.findIndex((r) => r.id === op.row.id)
        if (idx >= 0) table.rows[idx] = op.row
        else table.rows.push(op.row)
        break
      }
      case 'setCell': {
        const table = findFirstTable(next.nodes)
        if (!table) throw new PiDslError('setCell: no table in page')
        const row = table.rows.find((r) => r.id === op.rowId)
        if (!row) throw new PiDslError(`setCell: row ${op.rowId} not found`)
        if (typeof op.value === 'string') assertSafeText(op.value, 'setCell')
        else validateNode(op.value, 'setCell')
        row.cells[op.columnId] = op.value
        break
      }
      case 'upsertBoardCard': {
        const board = findFirstBoard(next.nodes)
        if (!board) throw new PiDslError('upsertBoardCard: no board in page')
        const { columnId, ...card } = op.card
        const col = board.columns.find((c) => c.id === columnId)
        if (!col) {
          throw new PiDslError(`upsertBoardCard: column ${columnId} not found`)
        }
        assertSafeText(card.title, 'upsertBoardCard')
        const existing = board.cards.findIndex((c) => c.id === card.id)
        if (existing >= 0) board.cards[existing] = card
        else board.cards.push(card)
        if (!col.cardIds.includes(card.id)) col.cardIds.push(card.id)
        for (const c of board.columns) {
          if (c.id !== columnId) {
            c.cardIds = c.cardIds.filter((id) => id !== card.id)
          }
        }
        break
      }
      case 'moveBoardCard': {
        const board = findFirstBoard(next.nodes)
        if (!board) throw new PiDslError('moveBoardCard: no board in page')
        const to = board.columns.find((c) => c.id === op.toColumnId)
        if (!to) {
          throw new PiDslError(
            `moveBoardCard: column ${op.toColumnId} not found`,
          )
        }
        for (const c of board.columns) {
          c.cardIds = c.cardIds.filter((id) => id !== op.cardId)
        }
        to.cardIds.push(op.cardId)
        break
      }
      case 'bindRecord':
        // Record binding is applied by write-path; patch op is a no-op on doc.
        break
      default:
        throw new PiDslError('Unknown patch op')
    }
  }

  return validatePageDoc(next)
}
