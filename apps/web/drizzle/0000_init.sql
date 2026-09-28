CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`prefix` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`description` text,
	`cover_url` text,
	`parent_id` text,
	`smart_rules` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `collections_parent_idx` ON `collections` (`parent_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`save_id` text,
	`kind` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_key` text NOT NULL,
	`original_name` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`save_id`) REFERENCES `saves`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `files_save_idx` ON `files` (`save_id`);--> statement-breakpoint
CREATE TABLE `save_collections` (
	`save_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`added_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`save_id`, `collection_id`),
	FOREIGN KEY (`save_id`) REFERENCES `saves`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `save_collections_col_idx` ON `save_collections` (`collection_id`);--> statement-breakpoint
CREATE TABLE `save_tags` (
	`save_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`save_id`, `tag_id`),
	FOREIGN KEY (`save_id`) REFERENCES `saves`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `save_tags_tag_idx` ON `save_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `saves` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`type` text DEFAULT 'link' NOT NULL,
	`status` text DEFAULT 'inbox' NOT NULL,
	`url` text,
	`normalized_url` text,
	`title` text NOT NULL,
	`description` text,
	`domain` text,
	`favicon_url` text,
	`image_url` text,
	`notes` text,
	`body` text,
	`extracted_text` text,
	`ai_summary` text,
	`is_favorite` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`capture_method` text DEFAULT 'web' NOT NULL,
	`source` text,
	`metadata` text,
	`metadata_status` text DEFAULT 'none' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_opened_at` integer,
	`open_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saves_seq_idx` ON `saves` (`seq`);--> statement-breakpoint
CREATE INDEX `saves_created_idx` ON `saves` (`created_at`);--> statement-breakpoint
CREATE INDEX `saves_status_idx` ON `saves` (`status`,`is_archived`,`created_at`);--> statement-breakpoint
CREATE INDEX `saves_fav_idx` ON `saves` (`is_favorite`,`created_at`);--> statement-breakpoint
CREATE INDEX `saves_domain_idx` ON `saves` (`domain`);--> statement-breakpoint
CREATE INDEX `saves_type_idx` ON `saves` (`type`);--> statement-breakpoint
CREATE INDEX `saves_norm_url_idx` ON `saves` (`normalized_url`);--> statement-breakpoint
CREATE INDEX `saves_opened_idx` ON `saves` (`last_opened_at`);--> statement-breakpoint
CREATE TABLE `session_items` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`save_id` text,
	`position` integer NOT NULL,
	`window_index` integer DEFAULT 0 NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`favicon_url` text,
	`pinned` integer DEFAULT false NOT NULL,
	`group_title` text,
	`group_color` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`save_id`) REFERENCES `saves`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `session_items_session_idx` ON `session_items` (`session_id`,`position`);--> statement-breakpoint
CREATE INDEX `session_items_save_idx` ON `session_items` (`save_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`browser` text,
	`tab_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_restored_at` integer
);
--> statement-breakpoint
CREATE INDEX `sessions_created_idx` ON `sessions` (`created_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_idx` ON `tags` (`name`);