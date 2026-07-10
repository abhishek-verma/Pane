/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Server-side run records for keep-alive / trigger / digest-driven jobs. */
export const scheduledRuns = sqliteTable('scheduled_runs', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  sourceId: text('source_id'),
  idempotencyKey: text('idempotency_key').notNull(),
  prompt: text('prompt').notNull(),
  bucketId: text('bucket_id'),
  status: text('status').notNull().default('pending'),
  /** JSON: Array<{ toolCallId, toolName, class, fingerprint }> */
  completedStepsJson: text('completed_steps_json').notNull().default('[]'),
  conversationId: text('conversation_id'),
  result: text('result'),
  error: text('error'),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull(),
})

export type ScheduledRunRow = InferSelectModel<typeof scheduledRuns>
export type NewScheduledRunRow = InferInsertModel<typeof scheduledRuns>
