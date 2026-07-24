CREATE TABLE `chat_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`stop_reason` text,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `chat_turns_session_idx` ON `chat_turns` (`session_id`);--> statement-breakpoint
CREATE INDEX `chat_turns_status_idx` ON `chat_turns` (`status`);
