import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const actionLog = sqliteTable(
  'action_log',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    toolName: text('tool_name').notNull(),
    argsJson: text('args_json').notNull(),
    consequenceClass: text('consequence_class').notNull(),
    decision: text('decision').notNull(),
    outputSummary: text('output_summary'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    runIdx: index('action_log_run_idx').on(table.runId),
    convIdx: index('action_log_conv_idx').on(
      table.conversationId,
      table.createdAt,
    ),
  }),
)

export type ActionLogDecision =
  | 'executed'
  | 'dry-run'
  | 'denied'
  | 'approval-requested'
  | 'promoted'
