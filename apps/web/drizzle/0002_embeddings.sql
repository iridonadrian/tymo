CREATE TABLE `embeddings` (
	`save_id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`dims` integer NOT NULL,
	`vector` blob NOT NULL,
	`content_hash` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`save_id`) REFERENCES `saves`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `embeddings_model_idx` ON `embeddings` (`model`);