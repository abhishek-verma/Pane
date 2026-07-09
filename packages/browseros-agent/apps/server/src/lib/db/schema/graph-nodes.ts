/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { buckets } from './buckets'

export const graphNodes = sqliteTable(
  'graph_nodes',
  {
    id: text('id').primaryKey(),
    bucketId: text('bucket_id')
      .notNull()
      .references(() => buckets.id),
    kind: text('kind').notNull(),
    title: text('title'),
    uri: text('uri'),
    summary: text('summary'),
    provenance: text('provenance').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    bucketKindIdx: index('graph_nodes_bucket_kind_idx').on(
      table.bucketId,
      table.kind,
    ),
    bucketUpdatedIdx: index('graph_nodes_bucket_updated_idx').on(
      table.bucketId,
      table.updatedAt,
    ),
    uriIdx: index('graph_nodes_uri_idx').on(table.uri),
  }),
)
