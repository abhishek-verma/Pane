
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
