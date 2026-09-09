import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

export const layers = sqliteTable(
  'layers',
  {
    id: text('id').primaryKey(),
    latestVersion: text('latest_version').notNull(),
    activeVersion: text('active_version'),
    enabled: integer('enabled').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [check('layer_enabled_boolean', sql`${table.enabled} IN (0, 1)`)],
)

export const layerVersions = sqliteTable(
  'layer_versions',
  {
    layerId: text('layer_id')
      .notNull()
      .references(() => layers.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    definitionJson: text('definition_json').notNull(),
    policyHash: text('policy_hash').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.layerId, table.version] })],
)

export const layerState = sqliteTable(
  'layer_state',
  {
    singleton: integer('singleton').primaryKey(),
    revision: integer('revision').notNull().default(0),
    paused: integer('paused').notNull().default(0),
  },
  (table) => [
    check('layer_state_singleton', sql`${table.singleton} = 1`),
    check('layer_paused_boolean', sql`${table.paused} IN (0, 1)`),
  ],
)

export const layerSiteOverrides = sqliteTable(
  'layer_site_overrides',
  {
    origin: text('origin').primaryKey(),
    paused: integer('paused').notNull(),
  },
  (table) => [
    check('layer_site_paused_boolean', sql`${table.paused} IN (0, 1)`),
  ],
)

export const layerGrants = sqliteTable(
  'layer_grants',
  {
    layerId: text('layer_id')
      .notNull()
      .references(() => layers.id, { onDelete: 'cascade' }),
    policyHash: text('policy_hash').notNull(),
    grantedAt: integer('granted_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.layerId, table.policyHash] })],
)

export const layerVerifications = sqliteTable(
  'layer_verifications',
  {
    id: text('id').primaryKey(),
    layerId: text('layer_id').notNull(),
    version: text('version').notNull(),
    capabilityRevision: text('capability_revision').notNull(),
    policyHash: text('policy_hash').notNull(),
    checksJson: text('checks_json').notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.layerId, table.version],
      foreignColumns: [layerVersions.layerId, layerVersions.version],
    }).onDelete('cascade'),
    index('layer_verifications_version_idx').on(table.layerId, table.version),
  ],
)

export const layerTrash = sqliteTable('layer_trash', {
  layerId: text('layer_id')
    .primaryKey()
    .references(() => layers.id, { onDelete: 'cascade' }),
  deletedAt: integer('deleted_at').notNull(),
})

/** Also used by fallback bootstrap; kept byte-for-byte equal to migration 0020. */
export const LAYERS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS layers (
  id TEXT PRIMARY KEY NOT NULL,
  latest_version TEXT NOT NULL,
  active_version TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS layer_versions (
  layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (layer_id, version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS layer_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0, 1))
);
--> statement-breakpoint
INSERT OR IGNORE INTO layer_state(singleton, revision, paused) VALUES (1, 0, 0);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS layer_site_overrides (
  origin TEXT PRIMARY KEY NOT NULL,
  paused INTEGER NOT NULL CHECK(paused IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS layer_grants (
  layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  policy_hash TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (layer_id, policy_hash)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS layer_verifications (
  id TEXT PRIMARY KEY NOT NULL,
  layer_id TEXT NOT NULL,
  version TEXT NOT NULL,
  capability_revision TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (layer_id, version) REFERENCES layer_versions(layer_id, version) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS layer_verifications_version_idx ON layer_verifications(layer_id, version);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS layer_trash (
  layer_id TEXT PRIMARY KEY NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  deleted_at INTEGER NOT NULL
);
`
