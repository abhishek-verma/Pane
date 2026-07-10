/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Database as BunDatabase } from 'bun:sqlite'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { logger } from '../logger'
import * as schema from './schema'

export type BrowserOsDatabase = BunSQLiteDatabase<typeof schema>

interface DrizzleJournalEntry {
  tag: string
}

export interface DbHandle {
  path: string
  migrationsDir: string | null
  sqlite: BunDatabase
  db: BrowserOsDatabase
}

export interface OpenDbOptions {
  dbPath: string
  resourcesDir?: string
  migrationsDir?: string
  runMigrations?: boolean
}

const sourceMigrationsDir = fileURLToPath(
  new URL('./migrations', import.meta.url),
)

/** Opens BrowserOS SQLite and applies checked-in Drizzle migrations before callers use the DB. */
export function openBrowserOsDatabase(options: OpenDbOptions): DbHandle {
  const migrationsDir = resolveMigrationsDir(options)
  mkdirSync(dirname(options.dbPath), { recursive: true })

  const sqlite = new BunDatabase(options.dbPath)
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  if (options.runMigrations !== false) {
    if (migrationsDir) {
      migrate(db, { migrationsFolder: migrationsDir })
    } else {
      logger.warn(
        'Drizzle migrations unavailable; bootstrapping current schema',
        {
          dbPath: options.dbPath,
        },
      )
      bootstrapCurrentSchema(sqlite)
    }
  }

  return {
    path: options.dbPath,
    migrationsDir,
    sqlite,
    db,
  }
}

/** Resolves migrations from explicit test paths, packaged resources, or the source tree. */
export function resolveMigrationsDir(
  options: Pick<OpenDbOptions, 'migrationsDir' | 'resourcesDir'> = {},
): string | null {
  if (options.migrationsDir) {
    if (hasCompleteMigrationSet(options.migrationsDir)) {
      return options.migrationsDir
    }
    logger.warn(
      'Configured Drizzle migrations directory is missing or incomplete; bootstrapping current schema',
      { migrationsDir: options.migrationsDir },
    )
    return null
  }

  const candidates = [
    options.resourcesDir
      ? join(options.resourcesDir, 'db', 'migrations')
      : null,
    sourceMigrationsDir,
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    if (hasCompleteMigrationSet(candidate)) return candidate
  }

  return null
}

/** Accepts only migration folders Drizzle can read without filesystem errors. */
function hasCompleteMigrationSet(migrationsDir: string): boolean {
  const journal = readDrizzleJournal(
    join(migrationsDir, 'meta', '_journal.json'),
  )
  if (!journal) return false

  const journalTags = new Set(journal.entries.map((entry) => entry.tag))
  if (
    !currentMigrationHistory.every((migration) =>
      journalTags.has(migration.tag),
    )
  ) {
    return false
  }

  return journal.entries.every((entry) =>
    existsSync(join(migrationsDir, `${entry.tag}.sql`)),
  )
}

function readDrizzleJournal(
  journalPath: string,
): { entries: DrizzleJournalEntry[] } | null {
  if (!existsSync(journalPath)) return null

  try {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as unknown
    if (!isDrizzleJournal(journal)) return null
    return journal
  } catch {
    return null
  }
}

function isDrizzleJournal(
  value: unknown,
): value is { entries: DrizzleJournalEntry[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'entries' in value &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'tag' in entry &&
        typeof entry.tag === 'string',
    )
  )
}

/** Creates the current schema when packaged builds lack migration files, and marks those migrations applied. */
function bootstrapCurrentSchema(sqlite: BunDatabase): void {
  sqlite.exec('BEGIN')
  try {
    for (const statement of currentSchemaStatements) {
      sqlite.exec(statement)
    }
    const insertMigration = sqlite.prepare(`
      INSERT INTO __drizzle_migrations ("hash", "created_at")
      SELECT ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM __drizzle_migrations
        WHERE created_at = ?
      )
    `)
    for (const migration of currentMigrationHistory) {
      insertMigration.run(
        migration.hash,
        migration.createdAt,
        migration.createdAt,
      )
    }
    sqlite.exec('COMMIT')
  } catch (error) {
    sqlite.exec('ROLLBACK')
    throw error
  }
}

const currentMigrationHistory = [
  {
    tag: '0000_zippy_psylocke',
    hash: 'aadfc2e86410febb11a974d25d99d5f7196aa797d9635ced9a18cd4eeb503b61',
    createdAt: 1777750582590,
  },
  {
    tag: '0001_lazy_orphan',
    hash: '19e693f7b1adcd1d932fa6cf5638b5b158c66ea5de4f154bc59311f4d6f71261',
    createdAt: 1777752799806,
  },
  {
    tag: '0002_chemical_whirlwind',
    hash: '02b11bf1dc34a5a289efd216233a48f0b7b950cfc33eaa7ebe6dcbb15d07f75c',
    createdAt: 1777902205667,
  },
  {
    tag: '0003_scrub_hermes_credentials',
    hash: '34387e59aa1f0d6dc44c95836d2363b72982663c50d05d0c67ee58c211209f52',
    createdAt: 1781916712443,
  },
  {
    tag: '0004_complete_emma_frost',
    hash: '140343dccf85b6af747555794d50b87bef7be0de8dce4a233ac6f9d401dc487e',
    createdAt: 1782739796116,
  },
  {
    tag: '0005_loving_young_avengers',
    hash: '9441a9279c0e58e5ecf99a91bda81c541efee7254028261d9a3b852b2fb49508',
    createdAt: 1782818741531,
  },
  {
    tag: '0006_low_white_tiger',
    hash: 'eccaed1b3bd28eafbe06112d9f73786aa17fd0ee2cc985b13cc8827409dae9e9',
    createdAt: 1783592265849,
  },
  {
    tag: '0007_chemical_thunderball',
    hash: '81781e98ed1635c87d22231f98c65aacdf7d93733694aa506f6383214d20d101',
    createdAt: 1783592630922,
  },
  {
    tag: '0008_bored_karen_page',
    hash: '8bf55dfe9e69b6cbd0886a38ab4a5276f4352a2ac25882fe76f198cb3438f4de',
    createdAt: 1783682207926,
  },
  {
    tag: '0009_curvy_bucky',
    hash: '7a97736e4dec5d9c374f70f4ca91c10dfb209bfe725c255a161df1117878f1ac',
    createdAt: 1783689148142,
  },
]

// TODO(nikhil): Remove this fallback once Windows/Linux packaging always includes Drizzle migrations.
const currentSchemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS agent_definitions (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      adapter text NOT NULL,
      model_id text NOT NULL,
      reasoning_effort text NOT NULL,
      permission_mode text DEFAULT 'approve-all' NOT NULL,
      session_key text NOT NULL,
      pinned integer DEFAULT false NOT NULL,
      adapter_config_json text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS agent_definitions_session_key_unique
    ON agent_definitions (session_key)
  `,
  `
    CREATE INDEX IF NOT EXISTS agent_definitions_updated_at_idx
    ON agent_definitions (updated_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS agent_definitions_adapter_updated_at_idx
    ON agent_definitions (adapter, updated_at)
  `,
  `
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      browseros_id text NOT NULL,
      provider text NOT NULL,
      access_token text NOT NULL,
      refresh_token text NOT NULL,
      expires_at integer NOT NULL,
      email text,
      account_id text,
      updated_at integer NOT NULL,
      PRIMARY KEY (browseros_id, provider)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS oauth_tokens_browseros_id_idx
    ON oauth_tokens (browseros_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS produced_files (
      id text PRIMARY KEY NOT NULL,
      agent_definition_id text NOT NULL,
      session_key text NOT NULL,
      turn_id text NOT NULL,
      turn_prompt text NOT NULL,
      path text NOT NULL,
      size integer NOT NULL,
      mtime_ms integer NOT NULL,
      created_at integer NOT NULL,
      detected_by text DEFAULT 'diff' NOT NULL,
      FOREIGN KEY (agent_definition_id)
        REFERENCES agent_definitions(id)
        ON UPDATE no action
        ON DELETE cascade
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS produced_files_agent_path_unique
    ON produced_files (agent_definition_id, path)
  `,
  `
    CREATE INDEX IF NOT EXISTS produced_files_agent_created_idx
    ON produced_files (agent_definition_id, created_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS produced_files_turn_idx
    ON produced_files (turn_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS produced_files_session_idx
    ON produced_files (session_key)
  `,
  `
    UPDATE agent_definitions
    SET adapter_config_json = NULL
    WHERE adapter = 'hermes' AND adapter_config_json IS NOT NULL
  `,
  `
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS chat_messages (
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON UPDATE no action ON DELETE cascade
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS chat_messages_session_idx
    ON chat_messages (session_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS chat_messages_created_idx
    ON chat_messages (created_at)
  `,
  `
    CREATE TABLE IF NOT EXISTS action_log (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      conversation_id text NOT NULL,
      tool_name text NOT NULL,
      args_json text NOT NULL,
      consequence_class text NOT NULL,
      decision text NOT NULL,
      output_summary text,
      created_at integer NOT NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS action_log_run_idx
    ON action_log (run_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS action_log_conv_idx
    ON action_log (conversation_id, created_at)
  `,
  `
    CREATE TABLE IF NOT EXISTS buckets (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      kind text DEFAULT 'general' NOT NULL,
      created_at integer NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id text PRIMARY KEY NOT NULL,
      bucket_id text NOT NULL,
      kind text NOT NULL,
      title text,
      uri text,
      summary text,
      provenance text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (bucket_id) REFERENCES buckets(id)
        ON UPDATE no action ON DELETE no action
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS graph_nodes_bucket_kind_idx
    ON graph_nodes (bucket_id, kind)
  `,
  `
    CREATE INDEX IF NOT EXISTS graph_nodes_bucket_updated_idx
    ON graph_nodes (bucket_id, updated_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS graph_nodes_uri_idx
    ON graph_nodes (uri)
  `,
  `
    CREATE TABLE IF NOT EXISTS graph_edges (
      id text PRIMARY KEY NOT NULL,
      bucket_id text NOT NULL,
      from_id text NOT NULL,
      to_id text NOT NULL,
      kind text NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (bucket_id) REFERENCES buckets(id)
        ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (from_id) REFERENCES graph_nodes(id)
        ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (to_id) REFERENCES graph_nodes(id)
        ON UPDATE no action ON DELETE no action
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS graph_edges_bucket_from_idx
    ON graph_edges (bucket_id, from_id)
  `,
  `
    CREATE INDEX IF NOT EXISTS graph_edges_bucket_to_idx
    ON graph_edges (bucket_id, to_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS graph_events (
      id text PRIMARY KEY NOT NULL,
      bucket_id text NOT NULL,
      run_id text,
      tool_name text,
      node_id text,
      payload_json text NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (bucket_id) REFERENCES buckets(id)
        ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (node_id) REFERENCES graph_nodes(id)
        ON UPDATE no action ON DELETE no action
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS graph_events_bucket_created_idx
    ON graph_events (bucket_id, created_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS graph_events_run_idx
    ON graph_events (run_id)
  `,
  `
    CREATE VIRTUAL TABLE IF NOT EXISTS graph_index USING fts5(
      node_id UNINDEXED,
      bucket_id UNINDEXED,
      title,
      uri,
      summary
    )
  `,
  `
    INSERT OR IGNORE INTO buckets (id, name, kind, created_at)
    VALUES ('default', 'Default', 'general', 0)
  `,
  `
    CREATE TABLE IF NOT EXISTS domain_grants (
      domain text NOT NULL,
      bucket_id text NOT NULL,
      allowed integer NOT NULL,
      updated_at integer NOT NULL,
      PRIMARY KEY (domain, bucket_id),
      FOREIGN KEY (bucket_id) REFERENCES buckets(id)
        ON UPDATE no action ON DELETE no action
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS tasks (
      id text PRIMARY KEY NOT NULL,
      bucket_id text NOT NULL,
      title text NOT NULL,
      status text NOT NULL,
      notes text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      scheduled_job_id text,
      FOREIGN KEY (bucket_id) REFERENCES buckets(id)
        ON UPDATE no action ON DELETE no action
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS task_links (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL,
      node_id text NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
        ON UPDATE no action ON DELETE no action,
      FOREIGN KEY (node_id) REFERENCES graph_nodes(id)
        ON UPDATE no action ON DELETE no action
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS memory_entries (
      id text PRIMARY KEY NOT NULL,
      layer text NOT NULL,
      bucket_id text NOT NULL,
      content text NOT NULL,
      source text NOT NULL,
      status text NOT NULL,
      last_surfaced integer,
      usefulness real DEFAULT 0 NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS memory_entries_bucket_layer_status_idx
      ON memory_entries (bucket_id, layer, status)
  `,
  `
    CREATE INDEX IF NOT EXISTS memory_entries_last_surfaced_idx
      ON memory_entries (last_surfaced)
  `,
  `
    CREATE TABLE IF NOT EXISTS skills (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      provenance text NOT NULL,
      source_run text,
      bucket_id text NOT NULL,
      uses integer DEFAULT 0 NOT NULL,
      success_rate real,
      status text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS pending_approvals (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      conversation_id text,
      tool_call_id text NOT NULL,
      tool_name text NOT NULL,
      consequence_class text NOT NULL,
      preview_json text NOT NULL,
      approve_token text NOT NULL,
      deny_token text NOT NULL,
      status text DEFAULT 'pending' NOT NULL,
      created_at integer NOT NULL,
      expires_at integer NOT NULL,
      resolved_at integer
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS reach_secrets (
      transport text NOT NULL,
      key text NOT NULL,
      value text NOT NULL,
      updated_at integer NOT NULL,
      PRIMARY KEY (transport, key)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS scheduled_runs (
      id text PRIMARY KEY NOT NULL,
      source text NOT NULL,
      source_id text,
      idempotency_key text NOT NULL,
      prompt text NOT NULL,
      bucket_id text,
      status text DEFAULT 'pending' NOT NULL,
      completed_steps_json text DEFAULT '[]' NOT NULL,
      conversation_id text,
      result text,
      error text,
      started_at integer,
      completed_at integer,
      created_at integer NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS trigger_rules (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      enabled integer DEFAULT true NOT NULL,
      match_json text NOT NULL,
      prompt text NOT NULL,
      job_id text,
      bucket_id text NOT NULL,
      cooldown_ms integer DEFAULT 300000 NOT NULL,
      last_fired_at integer,
      match_count integer DEFAULT 0 NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `,
]
