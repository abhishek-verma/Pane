CREATE VIRTUAL TABLE `memory_index` USING fts5(
  `entry_id` UNINDEXED,
  `bucket_id` UNINDEXED,
  `layer` UNINDEXED,
  `content`
);--> statement-breakpoint
CREATE VIRTUAL TABLE `chat_index` USING fts5(
  `message_id` UNINDEXED,
  `session_id` UNINDEXED,
  `bucket_id` UNINDEXED,
  `role` UNINDEXED,
  `content`
);--> statement-breakpoint
CREATE TABLE `embedding_chunks` (
  `id` text PRIMARY KEY NOT NULL,
  `bucket_id` text NOT NULL,
  `source_kind` text NOT NULL,
  `source_id` text NOT NULL,
  `kind` text NOT NULL,
  `title` text,
  `uri` text,
  `text` text NOT NULL,
  `dims` integer NOT NULL,
  `embedding` blob NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `embedding_chunks_bucket_kind_idx` ON `embedding_chunks` (`bucket_id`,`source_kind`);--> statement-breakpoint
CREATE INDEX `embedding_chunks_source_idx` ON `embedding_chunks` (`source_kind`,`source_id`);--> statement-breakpoint
CREATE TABLE `embed_queue` (
  `id` text PRIMARY KEY NOT NULL,
  `bucket_id` text NOT NULL,
  `source_kind` text NOT NULL,
  `source_id` text NOT NULL,
  `kind` text NOT NULL,
  `title` text,
  `uri` text,
  `text` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `embed_queue_status_created_idx` ON `embed_queue` (`status`,`created_at`);
