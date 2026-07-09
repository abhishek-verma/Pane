/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { graphNodes } from './graph-nodes'
import { tasks } from './tasks'

export const taskLinks = sqliteTable('task_links', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id),
  nodeId: text('node_id')
    .notNull()
    .references(() => graphNodes.id),
  createdAt: integer('created_at').notNull(),
})
