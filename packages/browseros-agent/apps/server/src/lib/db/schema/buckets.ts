/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const buckets = sqliteTable('buckets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('general'),
  createdAt: integer('created_at').notNull(),
})
