CREATE TABLE IF NOT EXISTS agenda_items (
  id TEXT PRIMARY KEY NOT NULL,
  source_key TEXT NOT NULL UNIQUE,
  day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  data_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  user_fields_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agenda_items_day_status_idx ON agenda_items(day, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agenda_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  day TEXT NOT NULL,
  timezone TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  report_json TEXT,
  created_at INTEGER NOT NULL,
  checked_at INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agenda_reviews_day_idx ON agenda_reviews(day, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agenda_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT NOT NULL,
  evidence TEXT,
  created_at INTEGER NOT NULL
);
