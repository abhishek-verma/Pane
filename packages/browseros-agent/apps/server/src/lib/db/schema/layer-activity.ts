import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { layers } from './layers'

export const layerActivity = sqliteTable('layer_activity', {
  invocationId: text('invocation_id').primaryKey(),
  layerId: text('layer_id')
    .notNull()
    .references(() => layers.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  actionId: text('action_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  provider: text('provider').notNull(),
  status: text('status').notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  deadlineAt: integer('deadline_at').notNull(),
})

/** Metadata only. Page content, results, URLs and credentials are never stored. */
export const LAYER_ACTIVITY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS layer_activity (
  invocation_id TEXT PRIMARY KEY NOT NULL,
  layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  action_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled','interrupted')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  deadline_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS layer_activity_recent_idx ON layer_activity(started_at DESC);
`
