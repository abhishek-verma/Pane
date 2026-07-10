CREATE TABLE `pending_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`conversation_id` text,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`consequence_class` text NOT NULL,
	`preview_json` text NOT NULL,
	`approve_token` text NOT NULL,
	`deny_token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE TABLE `reach_secrets` (
	`transport` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`transport`, `key`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_id` text,
	`idempotency_key` text NOT NULL,
	`prompt` text NOT NULL,
	`bucket_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`completed_steps_json` text DEFAULT '[]' NOT NULL,
	`conversation_id` text,
	`result` text,
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trigger_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`match_json` text NOT NULL,
	`prompt` text NOT NULL,
	`job_id` text,
	`bucket_id` text NOT NULL,
	`cooldown_ms` integer DEFAULT 300000 NOT NULL,
	`last_fired_at` integer,
	`match_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
