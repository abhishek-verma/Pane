/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { buckets } from './buckets'
import { graphNodes } from './graph-nodes'

export const graphEdges = sqliteTable(
  'graph_edges',
  {
    id: text('id').primaryKey(),
    bucketId: text('bucket_id')
      .notNull()
      .references(() => buckets.id),
    fromId: text('from_id')
      .notNull()
      .references(() => graphNodes.id),
    toId: text('to_id')
      .notNull()
      .references(() => graphNodes.id),
    kind: text('kind').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    bucketFromIdx: index('graph_edges_bucket_from_idx').on(
      table.bucketId,
      table.fromId,
    ),
    bucketToIdx: index('graph_edges_bucket_to_idx').on(
      table.bucketId,
      table.toId,
    ),
  }),
)
