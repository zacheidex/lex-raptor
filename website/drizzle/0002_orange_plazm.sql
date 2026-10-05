CREATE TABLE `source_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `source_cache_expiry` ON `source_cache` (`expires`);--> statement-breakpoint
CREATE TABLE `source_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `source_provider_time` ON `source_requests` (`provider`,`created`);