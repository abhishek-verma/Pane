/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Reach credentials (SMTP/Telegram) — same local-SQLite pattern as oauth_tokens. */
export const reachSecrets = sqliteTable(
  'reach_secrets',
  {
    transport: text('transport').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.transport, table.key] })],
)

export type ReachSecretRow = InferSelectModel<typeof reachSecrets>
export type NewReachSecretRow = InferInsertModel<typeof reachSecrets>
