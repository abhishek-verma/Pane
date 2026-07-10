/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const triggerRules = sqliteTable('trigger_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** JSON: { toolName?, occurrenceN?, payloadContains? } */
  matchJson: text('match_json').notNull(),
  prompt: text('prompt').notNull(),
  jobId: text('job_id'),
  bucketId: text('bucket_id').notNull(),
  cooldownMs: integer('cooldown_ms').notNull().default(300_000),
  lastFiredAt: integer('last_fired_at'),
  matchCount: integer('match_count').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type TriggerRuleRow = InferSelectModel<typeof triggerRules>
export type NewTriggerRuleRow = InferInsertModel<typeof triggerRules>
