CREATE TABLE `research_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor` text NOT NULL,
	`created` integer NOT NULL,
	`state` text NOT NULL,
	`ai` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_visitor_created` ON `research_jobs` (`visitor`,`created`);