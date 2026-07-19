ALTER TABLE `capture_sessions` ADD COLUMN `site` text;--> statement-breakpoint
ALTER TABLE `capture_sessions` ADD COLUMN `room_key` text;--> statement-breakpoint
ALTER TABLE `capture_sessions` ADD COLUMN `last_chunk_at` integer;--> statement-breakpoint
ALTER TABLE `capture_sessions` ADD COLUMN `asr_watermark_pcm` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `capture_sessions` ADD COLUMN `last_asr_sequence` integer DEFAULT -1;--> statement-breakpoint
ALTER TABLE `capture_sessions` ADD COLUMN `include_mic` integer DEFAULT 0;--> statement-breakpoint
CREATE INDEX `capture_sessions_room_resume_idx` ON `capture_sessions` (`bucket_id`,`site`,`room_key`,`status`);
