CREATE TABLE scheduled_jobs (id TEXT PRIMARY KEY NOT NULL, definition_json TEXT NOT NULL, next_run_at INTEGER NOT NULL);
--> statement-breakpoint
ALTER TABLE scheduled_runs ADD execution_context_json TEXT;
