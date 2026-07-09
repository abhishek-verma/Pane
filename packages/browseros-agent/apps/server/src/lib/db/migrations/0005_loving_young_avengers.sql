CREATE TABLE `action_log` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`args_json` text NOT NULL,
	`consequence_class` text NOT NULL,
	`decision` text NOT NULL,
	`output_summary` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `action_log_run_idx` ON `action_log` (`run_id`);--> statement-breakpoint
CREATE INDEX `action_log_conv_idx` ON `action_log` (`conversation_id`,`created_at`);