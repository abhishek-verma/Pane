CREATE TABLE `capture_consents` (
	`domain` text NOT NULL,
	`class` text NOT NULL,
	`bucket_id` text NOT NULL,
	`allowed` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`domain`, `class`),
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `capture_consents_bucket_class_idx` ON `capture_consents` (`bucket_id`,`class`);
--> statement-breakpoint
CREATE TABLE `capture_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket_id` text NOT NULL,
	`kind` text NOT NULL,
	`tab_id` integer,
	`url` text,
	`title` text,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`transcript_path` text,
	`summary_path` text,
	`graph_node_id` text,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`graph_node_id`) REFERENCES `graph_nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `capture_sessions_bucket_started_idx` ON `capture_sessions` (`bucket_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `capture_sessions_status_idx` ON `capture_sessions` (`status`);
--> statement-breakpoint
CREATE TABLE `research_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket_id` text NOT NULL,
	`topic` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `research_threads_bucket_status_idx` ON `research_threads` (`bucket_id`,`status`);
--> statement-breakpoint
CREATE TABLE `research_thread_pages` (
	`thread_id` text NOT NULL,
	`node_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`quote` text,
	`url` text NOT NULL,
	`captured_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `node_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `research_threads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `graph_nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `research_thread_pages_order_idx` ON `research_thread_pages` (`thread_id`,`order_index`);
