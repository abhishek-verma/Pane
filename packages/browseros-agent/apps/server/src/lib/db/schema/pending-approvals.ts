/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const pendingApprovals = sqliteTable('pending_approvals', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  conversationId: text('conversation_id'),
  toolCallId: text('tool_call_id').notNull(),
  toolName: text('tool_name').notNull(),
  consequenceClass: text('consequence_class').notNull(),
  previewJson: text('preview_json').notNull(),
  approveToken: text('approve_token').notNull(),
  denyToken: text('deny_token').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  resolvedAt: integer('resolved_at'),
})

export type PendingApprovalRow = InferSelectModel<typeof pendingApprovals>
export type NewPendingApprovalRow = InferInsertModel<typeof pendingApprovals>
