import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { agentDefinitions } from './agents'

export const producedFiles = sqliteTable(
  'produced_files',
  {
    id: text('id').primaryKey(),
    agentDefinitionId: text('agent_definition_id')
      .notNull()
      .references(() => agentDefinitions.id, { onDelete: 'cascade' }),
    sessionKey: text('session_key').notNull(),
    turnId: text('turn_id').notNull(),
    turnPrompt: text('turn_prompt').notNull(),
    path: text('path').notNull(),
    size: integer('size').notNull(),
    mtimeMs: integer('mtime_ms').notNull(),
    createdAt: integer('created_at').notNull(),
    detectedBy: text('detected_by').notNull().default('diff'),
  },
  (table) => {
    return {
      agentPathUnique: uniqueIndex('produced_files_agent_path_unique').on(
        table.agentDefinitionId,
        table.path,
      ),
      agentCreatedIdx: index('produced_files_agent_created_idx').on(
        table.agentDefinitionId,
        table.createdAt,
      ),
      turnIdx: index('produced_files_turn_idx').on(table.turnId),
      sessionIdx: index('produced_files_session_idx').on(table.sessionKey),
    }
  },
)
