/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { buckets } from './buckets'
import { graphNodes } from './graph-nodes'

export const graphEvents = sqliteTable(
  'graph_events',
  {
    id: text('id').primaryKey(),
    bucketId: text('bucket_id')
      .notNull()
      .references(() => buckets.id),
    runId: text('run_id'),
    toolName: text('tool_name'),
    nodeId: text('node_id').references(() => graphNodes.id),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    bucketCreatedIdx: index('graph_events_bucket_created_idx').on(
      table.bucketId,
      table.createdAt,
    ),
    runIdx: index('graph_events_run_idx').on(table.runId),
  }),
)
