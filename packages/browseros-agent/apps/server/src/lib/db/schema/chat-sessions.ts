import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const chatSessions = sqliteTable('chat_sessions', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => {
    return {
      sessionIdx: index('chat_messages_session_idx').on(table.sessionId),
      createdIdx: index('chat_messages_created_idx').on(table.createdAt),
    }
  },
)
