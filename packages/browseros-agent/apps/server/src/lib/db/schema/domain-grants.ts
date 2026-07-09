/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { buckets } from './buckets'

export const domainGrants = sqliteTable(
  'domain_grants',
  {
    domain: text('domain').notNull(),
    bucketId: text('bucket_id')
      .notNull()
      .references(() => buckets.id),
    allowed: integer('allowed').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.domain, table.bucketId] }),
  }),
)
