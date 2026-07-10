/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

export const memoryEntries = sqliteTable(
  'memory_entries',
  {
    id: text('id').primaryKey(),
    layer: text('layer').notNull(),
    bucketId: text('bucket_id').notNull(),
    content: text('content').notNull(),
    source: text('source').notNull(),
    status: text('status').notNull(),
    lastSurfaced: integer('last_surfaced'),
    usefulness: real('usefulness').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('memory_entries_bucket_layer_status_idx').on(
      table.bucketId,
      table.layer,
      table.status,
    ),
    index('memory_entries_last_surfaced_idx').on(table.lastSurfaced),
  ],
)
