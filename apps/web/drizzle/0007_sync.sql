CREATE TABLE `sync_aliases` (
	`tbl` text NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	PRIMARY KEY(`tbl`, `from_id`)
);
--> statement-breakpoint
CREATE TABLE `sync_cursors` (
	`device` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tbl` text NOT NULL,
	`pk` text NOT NULL,
	`op` text NOT NULL,
	`cols` text,
	`at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_pending` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rec` text NOT NULL,
	`first_seen` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`muted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_versions` (
	`tbl` text NOT NULL,
	`pk` text NOT NULL,
	`col` text NOT NULL,
	`ver` text NOT NULL,
	PRIMARY KEY(`tbl`, `pk`, `col`)
);
