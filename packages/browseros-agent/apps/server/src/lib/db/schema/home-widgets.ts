/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const homeWidgets = sqliteTable(
  'home_widgets',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    sourceType: text('source_type').notNull(),
    sourceQuery: text('source_query'),
    sourceTemplateId: text('source_template_id'),
    sourceBucketId: text('source_bucket_id'),
    actionType: text('action_type').notNull(),
    actionTarget: text('action_target').notNull(),
    refreshMinutes: integer('refresh_minutes').notNull().default(5),
    createdBy: text('created_by').notNull(),
    status: text('status').notNull().default('active'),
    showCount: integer('show_count').notNull().default(0),
    lastActionAt: integer('last_action_at'),
    whyText: text('why_text').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('home_widgets_status_idx').on(t.status)],
)

export const homeWidgetCache = sqliteTable('home_widget_cache', {
  widgetId: text('widget_id').primaryKey(),
  dataJson: text('data_json').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

export type HomeWidgetRow = InferSelectModel<typeof homeWidgets>
export type NewHomeWidgetRow = InferInsertModel<typeof homeWidgets>
export type HomeWidgetCacheRow = InferSelectModel<typeof homeWidgetCache>
