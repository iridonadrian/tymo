ALTER TABLE `saves` ADD `snoozed_until` integer;--> statement-breakpoint
CREATE INDEX `saves_snoozed_idx` ON `saves` (`snoozed_until`);