/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  provenance: text('provenance').notNull(),
  sourceRun: text('source_run'),
  bucketId: text('bucket_id').notNull(),
  uses: integer('uses').notNull().default(0),
  successRate: real('success_rate'),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
