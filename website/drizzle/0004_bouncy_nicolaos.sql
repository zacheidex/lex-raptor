CREATE TABLE `research_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor` text NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`request_id` text NOT NULL,
	`rating` text NOT NULL,
	`issue` text NOT NULL,
	`comment` text NOT NULL,
	`model` text NOT NULL,
	`shared_context` text
);
--> statement-breakpoint
CREATE INDEX `feedback_visitor_time` ON `research_feedback` (`visitor`,`created`);