CREATE TABLE `buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'general' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `graph_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text,
	`uri` text,
	`summary` text,
	`provenance` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `graph_nodes_bucket_kind_idx` ON `graph_nodes` (`bucket_id`,`kind`);--> statement-breakpoint
CREATE INDEX `graph_nodes_bucket_updated_idx` ON `graph_nodes` (`bucket_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `graph_nodes_uri_idx` ON `graph_nodes` (`uri`);--> statement-breakpoint
CREATE TABLE `graph_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket_id` text NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_id`) REFERENCES `graph_nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_id`) REFERENCES `graph_nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `graph_edges_bucket_from_idx` ON `graph_edges` (`bucket_id`,`from_id`);--> statement-breakpoint
CREATE INDEX `graph_edges_bucket_to_idx` ON `graph_edges` (`bucket_id`,`to_id`);--> statement-breakpoint
CREATE TABLE `graph_events` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket_id` text NOT NULL,
	`run_id` text,
	`tool_name` text,
	`node_id` text,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `graph_nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `graph_events_bucket_created_idx` ON `graph_events` (`bucket_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `graph_events_run_idx` ON `graph_events` (`run_id`);--> statement-breakpoint
CREATE VIRTUAL TABLE `graph_index` USING fts5(
	node_id UNINDEXED,
	bucket_id UNINDEXED,
	title,
	uri,
	summary
);
--> statement-breakpoint
INSERT OR IGNORE INTO `buckets` (`id`, `name`, `kind`, `created_at`)
VALUES ('default', 'Default', 'general', 0);
