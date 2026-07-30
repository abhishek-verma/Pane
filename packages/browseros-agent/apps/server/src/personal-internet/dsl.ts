/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { BOARD_SHAPE_HINT } from './pi-node-schema'
import {
  PI_MAX_CHART_POINTS,
  PI_MAX_MERMAID_CHARS,
  sanitizePiSvg,
} from './sanitize-svg'
import type {
  PiAction,
  PiCardAction,
  PiMaterializePhase,
  PiMaterializeSection,
  PiNode,
  PiPageDoc,
  PiPageMeta,
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
  // Non-strings used to coerce via RegExp.test (e.g. undefined → "undefined")
  // and silently pass — that let corrupt boards reach the UI and crash it.
  if (typeof value !== 'string') {
    throw new PiDslError(`${label}: expected string`)
  }
  if (DANGEROUS_RE.test(value)) {
    throw new PiDslError(`Unsafe content in ${label}`)
  }
}

function requireNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PiDslError(`${label}: required`)
  }
  assertSafeText(value, label)
  return value.trim()
}

function slugCardId(title: string, index: number): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'card'
  return `card_${base}_${index}`
}

/**
 * Models often emit kanban as `{ columnId, title, description }` without
 * `card.id` or `column.cardIds`. Detect that, reject on agent writes, or
 * coerce when healing stored docs (`coerce: true`).
 */
export function normalizeBoardNode(
  node: Extract<PiNode, { type: 'board' }>,
  path: string,
  opts: { coerce?: boolean } = {},
): string[] {
  const coerce = opts.coerce === true
  const warnings: string[] = []

  if (!Array.isArray(node.columns)) {
    throw new PiDslError(`${path}: board columns required`)
  }
  if (!Array.isArray(node.cards)) {
    if (!coerce) {
      throw new PiDslError(
        `${path}: board cards must be an array. ${BOARD_SHAPE_HINT}`,
      )
    }
    ;(node as { cards: unknown }).cards = []
  }

  const agentShaped = node.cards.some((c) => {
    const raw = c as { columnId?: unknown; description?: unknown; id?: unknown }
    return (
      typeof raw.columnId === 'string' ||
      (raw.description != null && raw.subtitle == null) ||
      typeof raw.id !== 'string' ||
      !String(raw.id).trim()
    )
  })
  const missingCardIds = node.columns.some((c) => !Array.isArray(c.cardIds))

  if ((agentShaped || missingCardIds) && !coerce) {
    throw new PiDslError(`${path}: ${BOARD_SHAPE_HINT}`)
  }

  if (agentShaped || missingCardIds) {
    warnings.push(
      `${path}: coerced agent-shaped board (columnId/description/missing cardIds) into cardIds form`,
    )
  }

  for (const col of node.columns) {
    if (!Array.isArray(col.cardIds)) {
      col.cardIds = []
    }
  }

  const colById = new Map(node.columns.map((c) => [c.id, c]))
  const usedIds = new Set<string>()
  const nextCards: Extract<PiNode, { type: 'board' }>['cards'] = []

  for (let i = 0; i < node.cards.length; i++) {
    const raw = node.cards[i] as Extract<
      PiNode,
      { type: 'board' }
    >['cards'][number] & {
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

    const card: Extract<PiNode, { type: 'board' }>['cards'][number] = {
      id,
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(typeof raw.recordId === 'string' && raw.recordId.trim()
        ? { recordId: raw.recordId.trim() }
        : {}),
      ...(typeof raw.entityKey === 'string' && raw.entityKey.trim()
        ? { entityKey: raw.entityKey.trim() }
        : {}),
      ...(Array.isArray(raw.actions) ? { actions: raw.actions } : {}),
    }
    nextCards.push(card)

    const columnId = typeof raw.columnId === 'string' ? raw.columnId.trim() : ''
    if (columnId && colById.has(columnId)) {
      const col = colById.get(columnId)!
      if (!col.cardIds.includes(id)) col.cardIds.push(id)
    }
  }

  node.cards = nextCards

  // Drop unknown ids; place unassigned cards in the first column.
  const known = new Set(node.cards.map((c) => c.id))
  for (const col of node.columns) {
    col.cardIds = [...new Set(col.cardIds.filter((id) => known.has(id)))]
  }
  const placed = new Set(node.columns.flatMap((c) => c.cardIds))
  const first = node.columns[0]
  if (first) {
    for (const card of node.cards) {
      if (!placed.has(card.id)) {
        first.cardIds.push(card.id)
        placed.add(card.id)
      }
    }
  }

  return warnings
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

function validateNode(
  node: PiNode,
  path: string,
  opts: { coerceBoards?: boolean } = {},
): void {
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
      if (node.id != null) {
        if (typeof node.id !== 'string' || !node.id.trim()) {
          throw new PiDslError(`${path}: stack id must be a non-empty string`)
        }
        assertSafeText(node.id, `${path}.id`)
      }
      for (const [i, child] of node.children.entries()) {
        validateNode(child, `${path}.children[${i}]`, opts)
      }
      return
    case 'button':
      assertSafeText(node.label, path)
      validateAction(node.action, `${path}.action`)
      if (node.replaceWith)
        validateNode(node.replaceWith, `${path}.replaceWith`, opts)
      return
    case 'link':
      assertSafeText(node.label, path)
      validateAction(node.action, `${path}.action`)
      return
    case 'table':
      for (const col of node.columns) {
        // Models often emit `title` instead of `header`.
        const colAny = col as { id: string; header?: string; title?: string }
        if (!colAny.header && colAny.title) colAny.header = colAny.title
        assertSafeText(col.id, path)
        assertSafeText(col.header ?? '', path)
      }
      for (const row of node.rows) {
        assertSafeText(row.id, path)
        // Models sometimes emit cells as string[] aligned to columns, or as
        // [{ columnId, value }]. Normalize to Record before persist.
        const rawCells = row.cells as unknown
        if (Array.isArray(rawCells)) {
          const rec: Record<string, PiNode | string> = {}
          if (
            rawCells.length > 0 &&
            typeof rawCells[0] === 'object' &&
            rawCells[0] !== null &&
            'columnId' in (rawCells[0] as object)
          ) {
            for (const cell of rawCells as Array<{
              columnId: string
              value: PiNode | string
            }>) {
              assertSafeText(cell.columnId, path)
              if (typeof cell.value === 'string')
                assertSafeText(cell.value, path)
              else
                validateNode(cell.value, `${path}.cells.${cell.columnId}`, opts)
              rec[cell.columnId] = cell.value
            }
          } else {
            for (const [i, col] of node.columns.entries()) {
              const v = rawCells[i]
              if (typeof v === 'string') assertSafeText(v, path)
              else if (v != null)
                validateNode(v as PiNode, `${path}.cells.${col.id}`, opts)
              if (v != null) rec[col.id] = v as PiNode | string
            }
          }
          row.cells = rec
        } else {
          for (const [k, v] of Object.entries(row.cells)) {
            assertSafeText(k, path)
            if (typeof v === 'string') assertSafeText(v, path)
            else validateNode(v, `${path}.cells.${k}`, opts)
          }
        }
      }
      return
    case 'board': {
      normalizeBoardNode(node, path, { coerce: opts.coerceBoards === true })
      for (const col of node.columns) {
        requireNonEmptyText(col.id, `${path}.column.id`)
        requireNonEmptyText(col.title, `${path}.column.title`)
        if (!Array.isArray(col.cardIds)) {
          throw new PiDslError(`${path}: column.cardIds required`)
        }
      }
      for (const card of node.cards) {
        requireNonEmptyText(card.id, `${path}.card.id`)
        requireNonEmptyText(card.title, `${path}.card.title`)
        if (card.subtitle) assertSafeText(card.subtitle, path)
        if (card.entityKey) assertSafeText(card.entityKey, path)
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
    }
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

const MATERIALIZE_PHASES: PiMaterializePhase[] = [
  'atf',
  'btf-structure',
  'btf-filling',
  'done',
]

const SECTION_STATUSES: PiMaterializeSection['status'][] = [
  'shell',
  'filled',
  'skipped',
]

function validatePageMeta(raw: unknown, path: string): PiPageMeta | undefined {
  if (raw == null) return undefined
  if (typeof raw !== 'object') {
    throw new PiDslError(`${path}: meta must be an object`)
  }
  const obj = raw as Record<string, unknown>
  const meta: PiPageMeta = {}
  if (obj.entityKey != null) {
    if (typeof obj.entityKey !== 'string' || !obj.entityKey.trim()) {
      throw new PiDslError(`${path}.entityKey must be a non-empty string`)
    }
    assertSafeText(obj.entityKey, `${path}.entityKey`)
    meta.entityKey = obj.entityKey.trim()
  }
  if (obj.materialize != null) {
    if (typeof obj.materialize !== 'object') {
      throw new PiDslError(`${path}.materialize must be an object`)
    }
    const m = obj.materialize as Record<string, unknown>
    if (
      typeof m.phase !== 'string' ||
      !MATERIALIZE_PHASES.includes(m.phase as PiMaterializePhase)
    ) {
      throw new PiDslError(`${path}.materialize.phase invalid`)
    }
    if (!Array.isArray(m.sections)) {
      throw new PiDslError(`${path}.materialize.sections must be an array`)
    }
    const sections: PiMaterializeSection[] = []
    for (const [i, s] of m.sections.entries()) {
      if (!s || typeof s !== 'object') {
        throw new PiDslError(`${path}.materialize.sections[${i}] invalid`)
      }
      const sec = s as Record<string, unknown>
      if (typeof sec.id !== 'string' || !sec.id.trim()) {
        throw new PiDslError(`${path}.materialize.sections[${i}].id required`)
      }
      if (typeof sec.title !== 'string' || !sec.title.trim()) {
        throw new PiDslError(
          `${path}.materialize.sections[${i}].title required`,
        )
      }
      if (
        typeof sec.status !== 'string' ||
        !SECTION_STATUSES.includes(sec.status as PiMaterializeSection['status'])
      ) {
        throw new PiDslError(
          `${path}.materialize.sections[${i}].status invalid`,
        )
      }
      assertSafeText(sec.id, `${path}.sections[${i}].id`)
      assertSafeText(sec.title, `${path}.sections[${i}].title`)
      sections.push({
        id: sec.id.trim(),
        title: sec.title.trim(),
        status: sec.status as PiMaterializeSection['status'],
      })
    }
    meta.materialize = {
      phase: m.phase as PiMaterializePhase,
      sections,
    }
  }
  return meta
}

export function validatePageDoc(
  input: unknown,
  opts: { coerceBoards?: boolean } = {},
): PiPageDoc {
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
  const meta = validatePageMeta(raw.meta, 'meta')
  const doc: PiPageDoc = {
    version: 1,
    title: raw.title,
    nodes: raw.nodes as PiNode[],
    ...(meta ? { meta } : {}),
  }
  const bytes = Buffer.byteLength(JSON.stringify(doc), 'utf8')
  if (bytes > MAX_DOC_BYTES) {
    throw new PiDslError(`Page doc exceeds ${MAX_DOC_BYTES} bytes`)
  }
  for (const [i, node] of doc.nodes.entries()) {
    validateNode(node, `nodes[${i}]`, opts)
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

/** Drop "More sections loading…" placeholders before appending BTF sections. */
export function stripMaterializePlaceholders(nodes: PiNode[]): PiNode[] {
  const out: PiNode[] = []
  for (const n of nodes) {
    if (n.type === 'note' && /more sections loading/i.test(n.text)) {
      continue
    }
    if (n.type === 'stack' && n.id === 'btf-root') {
      const children = n.children.filter(
        (c) => !(c.type === 'note' && /more sections loading/i.test(c.text)),
      )
      // Flatten emptied btf-root so appended sections sit at page root.
      if (children.length === 0) continue
      out.push({ ...n, children })
      continue
    }
    out.push(n)
  }
  return out
}

/**
 * Models often `replaceNodes` with a single BTF section, wiping ATF.
 * During materialize, treat a replace that does not start with the page
 * title as an append instead.
 */
export function shouldAppendSectionReplace(
  doc: PiPageDoc,
  nodes: PiNode[],
): boolean {
  const phase = doc.meta?.materialize?.phase
  if (!phase || phase === 'done') return false
  if (nodes.length === 0) return false
  const first = nodes[0]
  if (first?.type !== 'title') return false
  return first.text.trim() !== doc.title.trim()
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
    ...(doc.meta ? { meta: structuredClone(doc.meta) } : {}),
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
        if (shouldAppendSectionReplace(next, op.nodes)) {
          const preserved = stripMaterializePlaceholders(next.nodes)
          next = {
            ...next,
            nodes: [...preserved, ...structuredClone(op.nodes)],
          }
        } else {
          next = { ...next, nodes: structuredClone(op.nodes) }
        }
        break
      case 'appendNodes':
        for (const [i, node] of op.nodes.entries()) {
          validateNode(node, `appendNodes[${i}]`)
        }
        next = {
          ...next,
          nodes: [
            ...stripMaterializePlaceholders(next.nodes),
            ...structuredClone(op.nodes),
          ],
        }
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
        normalizeBoardNode(board, 'upsertBoardCard', { coerce: true })
        const { columnId, ...card } = op.card
        const col = board.columns.find((c) => c.id === columnId)
        if (!col) {
          throw new PiDslError(`upsertBoardCard: column ${columnId} not found`)
        }
        assertSafeText(card.title, 'upsertBoardCard')
        if (!Array.isArray(col.cardIds)) col.cardIds = []
        const existing = board.cards.findIndex((c) => c.id === card.id)
        if (existing >= 0) board.cards[existing] = card
        else board.cards.push(card)
        if (!col.cardIds.includes(card.id)) col.cardIds.push(card.id)
        for (const c of board.columns) {
          if (!Array.isArray(c.cardIds)) c.cardIds = []
          if (c.id !== columnId) {
            c.cardIds = c.cardIds.filter((id) => id !== card.id)
          }
        }
        break
      }
      case 'moveBoardCard': {
        const board = findFirstBoard(next.nodes)
        if (!board) throw new PiDslError('moveBoardCard: no board in page')
        normalizeBoardNode(board, 'moveBoardCard', { coerce: true })
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
      case 'setMeta': {
        const merged: PiPageMeta = {
          ...(next.meta ?? {}),
          ...op.meta,
        }
        if (op.meta.materialize) {
          merged.materialize = structuredClone(op.meta.materialize)
        }
        next = {
          ...next,
          meta: validatePageMeta(merged, 'setMeta') ?? merged,
        }
        break
      }
      case 'setMaterializeSection': {
        assertSafeText(op.id, 'setMaterializeSection.id')
        if (op.title) assertSafeText(op.title, 'setMaterializeSection.title')
        if (!SECTION_STATUSES.includes(op.status)) {
          throw new PiDslError('setMaterializeSection: invalid status')
        }
        const materialize = next.meta?.materialize ?? {
          phase: 'btf-structure' as PiMaterializePhase,
          sections: [],
        }
        const sections = [...materialize.sections]
        const idx = sections.findIndex((s) => s.id === op.id)
        const title = op.title ?? (idx >= 0 ? sections[idx]!.title : op.id)
        const section: PiMaterializeSection = {
          id: op.id,
          title,
          status: op.status,
        }
        if (idx >= 0) sections[idx] = section
        else sections.push(section)
        let phase = materialize.phase
        if (phase === 'atf') {
          // Shell sections open structure; filled/skipped means filling started.
          phase = op.status === 'shell' ? 'btf-structure' : 'btf-filling'
        } else if (
          phase === 'btf-structure' &&
          (op.status === 'filled' || op.status === 'skipped')
        ) {
          phase = 'btf-filling'
        }
        next = {
          ...next,
          meta: {
            ...(next.meta ?? {}),
            materialize: {
              phase,
              sections,
            },
          },
        }
        break
      }
      default:
        throw new PiDslError('Unknown patch op')
    }
  }

  return validatePageDoc(next)
}
