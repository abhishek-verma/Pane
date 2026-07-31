/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Zod schemas for Personalised Internet page docs / nodes.
 * Exposed on agent tools so models see the real board shape (cardIds, not columnId).
 */

import { PI_LIMITS } from '@browseros/shared/constants/limits'
import { z } from 'zod'

const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('open-internal'),
    route: z.string().startsWith('#/'),
  }),
  z.object({
    kind: z.literal('open-external'),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal('local'),
    op: z.enum(['filter', 'expand', 'copy', 'dismiss']),
    args: z.record(z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('agent'),
    query: z.string().min(1),
    metadata: z.record(z.unknown()),
  }),
])

const labeledActionSchema = z.object({
  label: z.string().min(1),
  action: actionSchema,
})

const cardActionSchema = z.union([labeledActionSchema, actionSchema])

/** Cards on a page board — membership is via column.cardIds, never card.columnId. */
export const boardCardSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe('Stable card id referenced from column.cardIds'),
    title: z.string().min(1),
    subtitle: z
      .string()
      .optional()
      .describe('Optional secondary line (not "description")'),
    recordId: z.string().optional(),
    entityKey: z.string().optional(),
    actions: z.array(cardActionSchema).optional(),
  })
  .strict()

export const boardColumnSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  cardIds: z
    .array(z.string())
    .describe(
      'Ordered card ids in this column. Required. Do NOT put columnId on cards.',
    ),
})

export const boardNodeSchema = z.object({
  type: z.literal('board'),
  columns: z.array(boardColumnSchema).min(1),
  cards: z.array(boardCardSchema),
})

const chartNodeSchema = z.object({
  type: z.literal('chart'),
  chartType: z.enum(['bar', 'line', 'pie', 'horizontal-bar']),
  title: z.string().optional(),
  unit: z.string().optional(),
  data: z
    .array(z.object({ label: z.string(), value: z.number().finite() }))
    .min(1)
    .max(PI_LIMITS.MAX_CHART_POINTS),
})

const mermaidNodeSchema = z.object({
  type: z.literal('mermaid'),
  source: z.string().min(1).max(PI_LIMITS.MAX_MERMAID_CHARS),
  title: z.string().optional(),
})

const svgNodeSchema = z.object({
  type: z.literal('svg'),
  markup: z.string().min(1).max(PI_LIMITS.MAX_SVG_CHARS),
  title: z.string().optional(),
  alt: z.string().optional(),
})

export const piNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('title'), text: z.string() }),
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({ type: z.literal('note'), text: z.string() }),
    z.object({
      type: z.literal('badge'),
      text: z.string(),
      tone: z.enum(['neutral', 'good', 'warn', 'bad']).optional(),
    }),
    z.object({ type: z.literal('divider') }),
    z.object({
      type: z.literal('stack'),
      id: z.string().optional(),
      direction: z.enum(['row', 'col']).optional(),
      children: z.array(piNodeSchema),
    }),
    z.object({
      type: z.literal('button'),
      label: z.string(),
      action: actionSchema,
      replaceWith: piNodeSchema.optional(),
    }),
    z.object({
      type: z.literal('link'),
      label: z.string(),
      action: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('open-internal'),
          route: z.string().startsWith('#/'),
        }),
        z.object({
          kind: z.literal('open-external'),
          url: z.string().url(),
        }),
      ]),
    }),
    z.object({
      type: z.literal('table'),
      columns: z.array(
        z.object({ id: z.string(), header: z.string() }).passthrough(),
      ),
      rows: z.array(
        z.object({
          id: z.string(),
          recordId: z.string().optional(),
          cells: z.record(z.unknown()),
        }),
      ),
    }),
    boardNodeSchema,
    chartNodeSchema,
    mermaidNodeSchema,
    svgNodeSchema,
  ]),
)

export const pageDocSchema = z
  .object({
    version: z.literal(1),
    title: z.string().min(1),
    nodes: z.array(piNodeSchema).max(PI_LIMITS.MAX_NODES),
    meta: z.record(z.unknown()).optional(),
  })
  .describe(
    'PI page doc. For boards: columns[].cardIds + cards[].id/title/subtitle. Never put columnId or description on cards — use upsertBoardCard to place cards by columnId. Budgets: max 200 nodes, depth 12, at most 4 mermaid nodes, mermaid source ≤16KiB / 200 edges.',
  )

export const upsertBoardCardOpSchema = z.object({
  op: z.literal('upsertBoardCard'),
  card: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    columnId: z
      .string()
      .min(1)
      .describe(
        'Column to place the card in (op-level only, not on stored cards)',
      ),
    subtitle: z.string().optional(),
    recordId: z.string().optional(),
    entityKey: z.string().optional(),
    actions: z.array(cardActionSchema).optional(),
  }),
})

export const patchOpSchema = z.union([
  z.object({ op: z.literal('setTitle'), title: z.string().min(1) }),
  z.object({
    op: z.literal('replaceNodes'),
    nodes: z.array(piNodeSchema),
  }),
  z.object({
    op: z.literal('appendNodes'),
    nodes: z.array(piNodeSchema),
  }),
  z.object({
    op: z.literal('upsertTableRow'),
    row: z.object({
      id: z.string(),
      recordId: z.string().optional(),
      cells: z.record(z.unknown()),
    }),
  }),
  z.object({
    op: z.literal('setCell'),
    rowId: z.string(),
    columnId: z.string(),
    value: z.union([z.string(), piNodeSchema]),
  }),
  upsertBoardCardOpSchema,
  z.object({
    op: z.literal('moveBoardCard'),
    cardId: z.string(),
    toColumnId: z.string(),
  }),
  z.object({
    op: z.literal('bindRecord'),
    recordId: z.string(),
    data: z.record(z.unknown()),
  }),
  z.object({
    op: z.literal('setMeta'),
    meta: z.record(z.unknown()),
  }),
  z.object({
    op: z.literal('setMaterializeSection'),
    id: z.string(),
    status: z.enum(['shell', 'filled', 'skipped']),
    title: z.string().optional(),
  }),
])

/** Clear error copy when agents use Trello-style card.columnId boards. */
export const BOARD_SHAPE_HINT = [
  'Board shape is wrong.',
  'Stored cards need { id, title, subtitle? } and columns need { id, title, cardIds: string[] }.',
  'Do NOT put columnId or description on cards in the page doc.',
  'To place a card by column, prefer pi_page_patch upsertBoardCard with card: { id, title, columnId, subtitle? }.',
  'Example board shell:',
  '{"type":"board","columns":[{"id":"todo","title":"To Do","cardIds":["c1"]}],"cards":[{"id":"c1","title":"Register domain","subtitle":"pane.ai"}]}',
].join(' ')
