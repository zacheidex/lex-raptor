CREATE TABLE `demo_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `demo_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor` text NOT NULL,
	`session` text NOT NULL,
	`created` integer NOT NULL,
	`state` text NOT NULL,
	`charged` integer NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer
);
--> statement-breakpoint
CREATE INDEX `calls_visitor_time` ON `demo_calls` (`visitor`,`created`);--> statement-breakpoint
CREATE INDEX `calls_session_time` ON `demo_calls` (`session`,`created`);