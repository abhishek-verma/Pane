/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { buckets } from './buckets'

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  bucketId: text('bucket_id')
    .notNull()
    .references(() => buckets.id),
  title: text('title').notNull(),
  status: text('status').notNull(),
  notes: text('notes'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  scheduledJobId: text('scheduled_job_id'),
})
