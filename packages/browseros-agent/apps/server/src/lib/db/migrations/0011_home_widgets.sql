CREATE TABLE `home_widgets` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_type` text NOT NULL,
	`source_query` text,
	`source_template_id` text,
	`source_bucket_id` text,
	`action_type` text NOT NULL,
	`action_target` text NOT NULL,
	`refresh_minutes` integer DEFAULT 5 NOT NULL,
	`created_by` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`show_count` integer DEFAULT 0 NOT NULL,
	`last_action_at` integer,
	`why_text` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `home_widgets_status_idx` ON `home_widgets` (`status`);
--> statement-breakpoint
CREATE TABLE `home_widget_cache` (
	`widget_id` text PRIMARY KEY NOT NULL,
	`data_json` text NOT NULL,
	`expires_at` integer NOT NULL
);
