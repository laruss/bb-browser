CREATE TABLE IF NOT EXISTS `browser_history_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`search_text` text NOT NULL,
	`visit_count` integer NOT NULL,
	`last_visited_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `browser_history_entries_scope_url_idx` ON `browser_history_entries` (`scope_id`,`url`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `browser_history_entries_visited_idx` ON `browser_history_entries` (`last_visited_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `browser_history_entries_scope_visited_idx` ON `browser_history_entries` (`scope_id`,`last_visited_at`);