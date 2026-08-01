ALTER TABLE `pi_sites` ADD COLUMN `harvest_sources_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `pi_sites` ADD COLUMN `harvest_cadence_days` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `pi_sites` ADD COLUMN `harvest_instructions` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `pi_sites` ADD COLUMN `harvest_from_meetings` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pi_sites` ADD COLUMN `harvest_on_host_opened` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pi_sites` ADD COLUMN `harvest_allow_navigate` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pi_sites` ADD COLUMN `last_harvest_at` integer;--> statement-breakpoint
ALTER TABLE `pi_refresh_jobs` ADD COLUMN `filter_value` text;--> statement-breakpoint
UPDATE `pi_sites`
SET
  `harvest_sources_json` = '["' || replace(trim(`harvest_host`), '"', '') || '"]',
  `harvest_on_host_opened` = CASE WHEN `harvest_enabled` = 1 THEN 1 ELSE 0 END
WHERE `harvest_host` IS NOT NULL AND trim(`harvest_host`) != '';
