
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
