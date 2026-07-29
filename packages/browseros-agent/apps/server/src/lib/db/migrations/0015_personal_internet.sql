CREATE TABLE `pi_sites` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket_id` text DEFAULT 'default' NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`jtbd` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`template_id` text,
	`harvest_enabled` integer DEFAULT 0 NOT NULL,
	`harvest_host` text,
	`doorway_eligible` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE INDEX `pi_sites_status_idx` ON `pi_sites` (`status`);
--> statement-breakpoint
CREATE INDEX `pi_sites_slug_idx` ON `pi_sites` (`slug`);
--> statement-breakpoint
CREATE TABLE `pi_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text,
	`bucket_id` text DEFAULT 'default' NOT NULL,
	`kind` text DEFAULT 'entity' NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`file_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pi_pages_site_idx` ON `pi_pages` (`site_id`);
--> statement-breakpoint
CREATE INDEX `pi_pages_status_idx` ON `pi_pages` (`status`);
--> statement-breakpoint
CREATE TABLE `pi_records` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`bucket_id` text DEFAULT 'default' NOT NULL,
	`type` text NOT NULL,
	`data_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pi_records_site_idx` ON `pi_records` (`site_id`);
--> statement-breakpoint
CREATE TABLE `pi_pulses` (
	`site_id` text PRIMARY KEY NOT NULL,
	`pulse_json` text NOT NULL,
	`stale_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pi_refresh_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`policy_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pi_refresh_policies_target_idx` ON `pi_refresh_policies` (`target_type`,`target_id`);
--> statement-breakpoint
CREATE TABLE `pi_refresh_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`kind` text NOT NULL,
	`trigger_name` text NOT NULL,
	`coalesce_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_text` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pi_refresh_jobs_status_idx` ON `pi_refresh_jobs` (`status`);
--> statement-breakpoint
CREATE INDEX `pi_refresh_jobs_coalesce_idx` ON `pi_refresh_jobs` (`coalesce_key`);
--> statement-breakpoint
CREATE TABLE `pi_temps` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket_id` text DEFAULT 'default' NOT NULL,
	`title` text NOT NULL,
	`file_path` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pi_temps_status_idx` ON `pi_temps` (`status`);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `pi_index` USING fts5(
	entry_id UNINDEXED,
	bucket_id UNINDEXED,
	source_kind UNINDEXED,
	site_id UNINDEXED,
	uri UNINDEXED,
	title,
	content
);
