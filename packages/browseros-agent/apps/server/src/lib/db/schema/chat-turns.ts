/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { chatSessions } from './chat-sessions'

/** Durable mirror of sidepanel chat turns (memory registry is the hot path). */
export const chatTurns = sqliteTable(
  'chat_turns',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    stopReason: text('stop_reason'),
  },
  (table) => {
    return {
      sessionIdx: index('chat_turns_session_idx').on(table.sessionId),
      statusIdx: index('chat_turns_status_idx').on(table.status),
    }
  },
)

export type ChatTurnStatus =
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'interrupted'
