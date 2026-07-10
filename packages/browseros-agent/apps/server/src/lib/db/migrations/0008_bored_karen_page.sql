CREATE TABLE `memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`layer` text NOT NULL,
	`bucket_id` text NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`last_surfaced` integer,
	`usefulness` real DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_entries_bucket_layer_status_idx` ON `memory_entries` (`bucket_id`,`layer`,`status`);--> statement-breakpoint
CREATE INDEX `memory_entries_last_surfaced_idx` ON `memory_entries` (`last_surfaced`);--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`provenance` text NOT NULL,
	`source_run` text,
	`bucket_id` text NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`success_rate` real,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
